import { $ } from 'bun';

export interface SetupCheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  help?: string;
}

export interface SetupStatus {
  checks: SetupCheckResult[];
  ready: boolean;
}

export async function checkAwsCli(): Promise<SetupCheckResult> {
  try {
    const result = await $`aws --version`.quiet();
    const version = result.text().trim().split(' ')[0];
    return {
      name: 'AWS CLI',
      status: 'pass',
      message: version,
    };
  } catch {
    return {
      name: 'AWS CLI',
      status: 'fail',
      message: 'Not installed',
      help: 'Install AWS CLI:\n  macOS: brew install awscli\n  Linux: curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && unzip awscliv2.zip && sudo ./aws/install',
    };
  }
}

export async function checkAwsProfile(profileName: string): Promise<SetupCheckResult> {
  try {
    const result = await $`aws configure list --profile ${profileName}`.quiet();
    const output = result.text();

    if (output.includes('could not be found') || output.includes('not found')) {
      return {
        name: `AWS Profile "${profileName}"`,
        status: 'fail',
        message: 'Profile not found',
        help: `Create the profile:\n  aws configure --profile ${profileName}\n\nYou'll need:\n  - AWS Access Key ID\n  - AWS Secret Access Key\n  - Default region: us-east-1`,
      };
    }

    return {
      name: `AWS Profile "${profileName}"`,
      status: 'pass',
      message: 'Configured',
    };
  } catch (error) {
    return {
      name: `AWS Profile "${profileName}"`,
      status: 'fail',
      message: 'Profile not found',
      help: `Create the profile:\n  aws configure --profile ${profileName}\n\nYou'll need:\n  - AWS Access Key ID\n  - AWS Secret Access Key\n  - Default region: us-east-1`,
    };
  }
}

export async function checkAwsCredentials(profileName: string): Promise<SetupCheckResult> {
  try {
    const result = await $`aws sts get-caller-identity --profile ${profileName}`.quiet();
    const identity = JSON.parse(result.text());
    return {
      name: 'AWS Credentials',
      status: 'pass',
      message: `Account: ${identity.Account}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes('ExpiredToken')) {
      return {
        name: 'AWS Credentials',
        status: 'fail',
        message: 'Token expired',
        help: 'Your AWS session has expired. Refresh your credentials or run:\n  aws configure --profile ' + profileName,
      };
    }

    if (errorMsg.includes('InvalidClientTokenId') || errorMsg.includes('SignatureDoesNotMatch')) {
      return {
        name: 'AWS Credentials',
        status: 'fail',
        message: 'Invalid credentials',
        help: 'Your AWS credentials are invalid. Check your Access Key ID and Secret:\n  aws configure --profile ' + profileName,
      };
    }

    return {
      name: 'AWS Credentials',
      status: 'fail',
      message: 'Could not authenticate',
      help: `Verify your credentials:\n  aws sts get-caller-identity --profile ${profileName}`,
    };
  }
}

export async function checkEcsAccess(profileName: string, clusterName: string): Promise<SetupCheckResult> {
  try {
    await $`aws ecs describe-clusters --clusters ${clusterName} --profile ${profileName} --region us-east-1`.quiet();
    return {
      name: 'ECS Access',
      status: 'pass',
      message: `Can access cluster "${clusterName}"`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes('AccessDenied') || errorMsg.includes('not authorized')) {
      return {
        name: 'ECS Access',
        status: 'fail',
        message: 'Access denied',
        help: 'Your IAM user needs ECS permissions:\n  - ecs:DescribeClusters\n  - ecs:DescribeServices\n  - ecs:ListTasks\n  - ecs:DescribeTasks\n\nContact your admin to grant access.',
      };
    }

    return {
      name: 'ECS Access',
      status: 'warn',
      message: 'Could not verify',
      help: 'Could not verify ECS access. You may still be able to use the TUI.',
    };
  }
}

export async function checkLogsAccess(profileName: string, logGroup: string): Promise<SetupCheckResult> {
  try {
    await $`aws logs describe-log-groups --log-group-name-prefix ${logGroup} --profile ${profileName} --region us-east-1`.quiet();
    return {
      name: 'CloudWatch Logs',
      status: 'pass',
      message: 'Can access logs',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    if (errorMsg.includes('AccessDenied')) {
      return {
        name: 'CloudWatch Logs',
        status: 'warn',
        message: 'Access denied',
        help: 'Your IAM user needs CloudWatch Logs permissions:\n  - logs:DescribeLogGroups\n  - logs:DescribeLogStreams\n  - logs:GetLogEvents\n\nYou can still use the TUI but logs won\'t work.',
      };
    }

    return {
      name: 'CloudWatch Logs',
      status: 'warn',
      message: 'Could not verify',
    };
  }
}

export async function runSetupChecks(profileName: string = 'Swappu'): Promise<SetupStatus> {
  const checks: SetupCheckResult[] = [];

  // Check AWS CLI
  const cliCheck = await checkAwsCli();
  checks.push(cliCheck);

  if (cliCheck.status === 'fail') {
    return { checks, ready: false };
  }

  // Check profile
  const profileCheck = await checkAwsProfile(profileName);
  checks.push(profileCheck);

  if (profileCheck.status === 'fail') {
    return { checks, ready: false };
  }

  // Check credentials
  const credCheck = await checkAwsCredentials(profileName);
  checks.push(credCheck);

  if (credCheck.status === 'fail') {
    return { checks, ready: false };
  }

  // Check ECS access
  const ecsCheck = await checkEcsAccess(profileName, 'suwappu-cluster');
  checks.push(ecsCheck);

  // Check logs access
  const logsCheck = await checkLogsAccess(profileName, '/ecs/suwappu');
  checks.push(logsCheck);

  const ready = checks.every(c => c.status !== 'fail');

  return { checks, ready };
}
