import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';

export class SuwappuStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: ecs.Cluster;
  public readonly database: rds.DatabaseInstance;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==================== VPC ====================
    this.vpc = new ec2.Vpc(this, 'SuwappuVpc', {
      maxAzs: 2,
      natGateways: 1, // Cost optimization: 1 NAT gateway
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // ==================== Security Groups ====================
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ALB',
      allowAllOutbound: true,
    });
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP'
    );
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS'
    );

    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ECS tasks',
      allowAllOutbound: true,
    });
    ecsSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(10000),
      'Allow from ALB'
    );

    const rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for RDS',
      allowAllOutbound: false,
    });
    rdsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from ECS'
    );

    // ==================== Secrets Manager ====================
    // Application secrets (manually populate after deployment)
    const appSecrets = new secretsmanager.Secret(this, 'SuwappuSecrets', {
      secretName: 'suwappu/app-secrets',
      description: 'Suwappu application secrets',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          TELEGRAM_BOT_TOKEN: 'REPLACE_ME',
          ENCRYPTION_KEY: 'REPLACE_ME',
          ADMIN_API_KEY: 'REPLACE_ME',
          LIFI_API_KEY: 'REPLACE_ME',
          TURNKEY_ORGANIZATION_ID: 'REPLACE_ME',
          TURNKEY_API_PUBLIC_KEY: 'REPLACE_ME',
          TURNKEY_API_PRIVATE_KEY: 'REPLACE_ME',
          WHATSAPP_ACCESS_TOKEN: 'REPLACE_ME',
          WHATSAPP_PHONE_NUMBER_ID: 'REPLACE_ME',
          ADMIN_IDS: 'REPLACE_ME',
        }),
        generateStringKey: 'SECRET_KEY',
      },
    });

    // ==================== RDS PostgreSQL ====================
    const rdsEncryptionKey = new kms.Key(this, 'RdsEncryptionKey', {
      alias: 'suwappu/rds',
      description: 'KMS key for Suwappu RDS encryption at rest',
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // NOTE: storageEncrypted requires instance replacement — migrate separately
    // via snapshot-copy-encrypt-restore workflow.
    // After migration, add: storageEncrypted: true, storageEncryptionKey: rdsEncryptionKey
    this.database = new rds.DatabaseInstance(this, 'SuwappuDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [rdsSecurityGroup],
      databaseName: 'suwappubot',
      credentials: rds.Credentials.fromGeneratedSecret('suwappu', {
        secretName: 'suwappu/db-credentials',
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      multiAz: true, // High availability
      deletionProtection: true,
      backupRetention: cdk.Duration.days(14),
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      publiclyAccessible: false,
    });

    // ==================== ECR Repository ====================
    const repository = new ecr.Repository(this, 'SuwappuRepository', {
      repositoryName: 'suwappu',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      imageScanOnPush: true,
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: 'Keep only 10 images',
        },
      ],
    });

    // ==================== ECS Cluster ====================
    this.cluster = new ecs.Cluster(this, 'SuwappuCluster', {
      vpc: this.vpc,
      clusterName: 'suwappu-cluster',
      containerInsights: true,
    });

    // ==================== CloudWatch Log Group ====================
    const logGroup = new logs.LogGroup(this, 'SuwappuLogs', {
      logGroupName: '/ecs/suwappu',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ==================== Task Definition ====================
    // NOTE: ECS services (suwappu-bot-prod, suwappu-api-ts-*, suwappu-webapp-*)
    // are managed outside CDK. This task definition is kept for reference but
    // the Fargate service has been removed from CDK to avoid state drift.
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'SuwappuTask', {
      memoryLimitMiB: 1024,
      cpu: 512,
    });

    // Grant secrets access to task
    appSecrets.grantRead(taskDefinition.taskRole);
    this.database.secret?.grantRead(taskDefinition.taskRole);

    // Grant SSM permissions for ECS Exec
    taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'ssmmessages:CreateControlChannel',
          'ssmmessages:CreateDataChannel',
          'ssmmessages:OpenControlChannel',
          'ssmmessages:OpenDataChannel',
        ],
        resources: ['*'],
      }),
    );

    // Container definition
    const container = taskDefinition.addContainer('suwappu', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'suwappu',
        logGroup,
      }),
      environment: {
        LOG_LEVEL: 'INFO',
        WALLET_PROVIDER: 'local',
        PORT: '10000',
      },
      secrets: {
        // Database URL from RDS secret
        DATABASE_URL: ecs.Secret.fromSecretsManager(
          this.database.secret!,
          'DATABASE_URL'
        ),
        // App secrets
        TELEGRAM_BOT_TOKEN: ecs.Secret.fromSecretsManager(
          appSecrets,
          'TELEGRAM_BOT_TOKEN'
        ),
        ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(
          appSecrets,
          'ENCRYPTION_KEY'
        ),
        SECRET_KEY: ecs.Secret.fromSecretsManager(appSecrets, 'SECRET_KEY'),
        ADMIN_API_KEY: ecs.Secret.fromSecretsManager(
          appSecrets,
          'ADMIN_API_KEY'
        ),
        LIFI_API_KEY: ecs.Secret.fromSecretsManager(appSecrets, 'LIFI_API_KEY'),
        ADMIN_IDS: ecs.Secret.fromSecretsManager(appSecrets, 'ADMIN_IDS'),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:10000/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    container.addPortMappings({
      containerPort: 10000,
      protocol: ecs.Protocol.TCP,
    });

    // ==================== Application Load Balancer ====================
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'SuwappuAlb', {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
    });

    // ==================== ACM Certificate ====================
    const certificateArn = this.node.tryGetContext('certificateArn');
    if (!certificateArn) {
      throw new Error(
        'Missing required CDK context variable "certificateArn". ' +
        'Pass it via: cdk deploy -c certificateArn=arn:aws:acm:REGION:ACCOUNT:certificate/ID'
      );
    }
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'SuwappuCert',
      certificateArn,
    );

    // HTTP listener — redirect all traffic to HTTPS
    this.loadBalancer.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    // HTTPS listener with default fixed response (services add their own rules)
    const httpsListener = this.loadBalancer.addListener('HttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [certificate],
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'text/plain',
        messageBody: 'Not Found',
      }),
    });

    // ==================== WAF ====================
    const webAcl = new wafv2.CfnWebACL(this, 'SuwappuWaf', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'SuwappuWafMetrics',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'AWSCommonRules',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSCommonRules',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'RateLimit',
          priority: 2,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 300,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimit',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    new wafv2.CfnWebACLAssociation(this, 'WafAlbAssociation', {
      resourceArn: this.loadBalancer.loadBalancerArn,
      webAclArn: webAcl.attrArn,
    });

    // ==================== CloudWatch Alarms + SNS ====================
    const alertTopic = new sns.Topic(this, 'SuwappuAlerts', {
      topicName: 'suwappu-alerts',
    });

    // ALB 5xx alarm
    new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
      metric: this.loadBalancer.metrics.httpCodeTarget(
        elbv2.HttpCodeTarget.TARGET_5XX_COUNT,
        { period: cdk.Duration.minutes(5) },
      ),
      threshold: 10,
      evaluationPeriods: 1,
      alarmDescription: 'ALB 5xx errors > 10 in 5 minutes',
    }).addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // RDS CPU alarm
    new cloudwatch.Alarm(this, 'RdsCpuAlarm', {
      metric: this.database.metricCPUUtilization(),
      threshold: 80,
      evaluationPeriods: 2,
      alarmDescription: 'RDS CPU utilization > 80%',
    }).addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // RDS free storage alarm (< 5 GB)
    new cloudwatch.Alarm(this, 'RdsFreeStorageAlarm', {
      metric: this.database.metricFreeStorageSpace(),
      threshold: 5 * 1024 * 1024 * 1024, // 5 GB in bytes
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'RDS free storage < 5 GB',
    }).addAlarmAction(new cw_actions.SnsAction(alertTopic));

    // ==================== DB Backup (pre-deploy) ====================
    const backupBucket = new s3.Bucket(this, 'SuwappuDbBackups', {
      bucketName: 'suwappu-db-backups',
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const backupLogGroup = new logs.LogGroup(this, 'SuwappuBackupLogs', {
      logGroupName: '/ecs/suwappu-db-backup',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const backupTaskDef = new ecs.FargateTaskDefinition(this, 'SuwappuDbBackupTask', {
      memoryLimitMiB: 512,
      cpu: 256,
      family: 'suwappu-db-backup',
    });

    backupTaskDef.addContainer('backup', {
      image: ecs.ContainerImage.fromAsset('../scripts/db-backup'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'db-backup',
        logGroup: backupLogGroup,
      }),
      environment: {
        S3_BUCKET: backupBucket.bucketName,
        BACKUP_PREFIX: 'pre-deploy',
      },
      secrets: {
        DATABASE_URL: ecs.Secret.fromSecretsManager(
          this.database.secret!,
          'DATABASE_URL',
        ),
      },
    });

    backupBucket.grantPut(backupTaskDef.taskRole);
    this.database.secret?.grantRead(backupTaskDef.taskRole);
    appSecrets.grantRead(backupTaskDef.taskRole);

    new cdk.CfnOutput(this, 'BackupBucketName', {
      value: backupBucket.bucketName,
      description: 'S3 bucket for database backups',
      exportName: 'SuwappuBackupBucket',
    });

    new cdk.CfnOutput(this, 'BackupTaskDefinition', {
      value: backupTaskDef.family!,
      description: 'Task definition family for DB backup',
      exportName: 'SuwappuBackupTaskFamily',
    });

    // ==================== Outputs ====================
    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: this.loadBalancer.loadBalancerDnsName,
      description: 'Load Balancer DNS Name',
      exportName: 'SuwappuLoadBalancerDns',
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI',
      exportName: 'SuwappuEcrUri',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS Cluster Name',
      exportName: 'SuwappuClusterName',
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.database.dbInstanceEndpointAddress,
      description: 'RDS Database Endpoint',
      exportName: 'SuwappuDatabaseEndpoint',
    });

    new cdk.CfnOutput(this, 'SecretsArn', {
      value: appSecrets.secretArn,
      description: 'Secrets Manager ARN for app secrets',
      exportName: 'SuwappuSecretsArn',
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: alertTopic.topicArn,
      description: 'SNS Topic ARN for alerts (subscribe your email)',
      exportName: 'SuwappuAlertTopicArn',
    });
  }
}
