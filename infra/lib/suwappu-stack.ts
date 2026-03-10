import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import { Construct } from 'constructs';

export class SuwappuStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const isProduction = true; // Toggle for environment-based scaling
    const minCapacity = isProduction ? 2 : 1;
    const maxCapacity = isProduction ? 6 : 2;

    // ─── VPC ───────────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'SuwappuVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // ─── Security Groups ───────────────────────────────────────────────
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      description: 'Security group for ALB',
      allowAllOutbound: true,
    });
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP',
    );
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS',
    );

    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      description: 'Security group for ECS tasks',
      allowAllOutbound: true,
    });
    ecsSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(10000),
      'Allow from ALB',
    );

    const rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc,
      description: 'Security group for RDS',
      allowAllOutbound: false,
    });
    rdsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from ECS',
    );

    // ─── Secrets Manager ───────────────────────────────────────────────
    const appSecrets = new secretsmanager.Secret(this, 'SuwappuSecrets', {
      secretName: 'suwappu/app-secrets',
      description: 'Suwappu application secrets',
      generateSecretString: {
        generateStringKey: 'SECRET_KEY',
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
      },
    });
    appSecrets.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // ─── RDS PostgreSQL ────────────────────────────────────────────────
    const database = new rds.DatabaseInstance(this, 'SuwappuDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [rdsSecurityGroup],
      databaseName: 'suwappubot',
      credentials: rds.Credentials.fromGeneratedSecret('suwappu', {
        secretName: 'suwappu/db-credentials',
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      multiAz: false,
      publiclyAccessible: false,
      backupRetention: cdk.Duration.days(14),
      copyTagsToSnapshot: true,
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    // ─── ECR Repository ────────────────────────────────────────────────
    const repository = new ecr.Repository(this, 'SuwappuRepository', {
      repositoryName: 'suwappu',
      imageScanOnPush: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          description: 'Keep only 10 images',
          maxImageCount: 10,
        },
      ],
    });

    // ─── ECS Cluster ───────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'SuwappuCluster', {
      vpc,
      clusterName: 'suwappu-cluster',
      containerInsights: true,
    });

    // ─── CloudWatch Log Group ──────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'SuwappuLogs', {
      logGroupName: '/ecs/suwappu',
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── Shared Task Role ──────────────────────────────────────────────
    const taskRole = new iam.Role(this, 'SuwappuTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:DescribeSecret',
        ],
        resources: [
          database.secret!.secretArn,
          appSecrets.secretArn,
        ],
      }),
    );

    const executionRole = new iam.Role(this, 'SuwappuExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
        ],
        resources: [repository.repositoryArn],
      }),
    );
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
    );
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [logGroup.logGroupArn],
      }),
    );
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:DescribeSecret',
        ],
        resources: [
          database.secret!.secretArn,
          appSecrets.secretArn,
        ],
      }),
    );

    // ─── Common secrets for all tasks ──────────────────────────────────
    const commonSecrets: ecs.Secret[] = [
      ecs.Secret.fromSecretsManager(database.secret!, 'DATABASE_URL'),
      ecs.Secret.fromSecretsManager(appSecrets, 'TELEGRAM_BOT_TOKEN'),
      ecs.Secret.fromSecretsManager(appSecrets, 'ENCRYPTION_KEY'),
      ecs.Secret.fromSecretsManager(appSecrets, 'SECRET_KEY'),
      ecs.Secret.fromSecretsManager(appSecrets, 'ADMIN_API_KEY'),
      ecs.Secret.fromSecretsManager(appSecrets, 'LIFI_API_KEY'),
      ecs.Secret.fromSecretsManager(appSecrets, 'ADMIN_IDS'),
    ];

    const commonEnvironment: Record<string, string> = {
      LOG_LEVEL: 'INFO',
      WALLET_PROVIDER: 'local',
      PORT: '10000',
    };

    // ─── ALB ───────────────────────────────────────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, 'SuwappuAlb', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // HTTP -> HTTPS redirect
    alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({
        port: '443',
        protocol: 'HTTPS',
        permanent: true,
      }),
    });

    // HTTPS listener with default 404
    const httpsListener = alb.addListener('HttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [
        elbv2.ListenerCertificate.fromArn(
          'arn:aws:acm:us-east-1:905418423235:certificate/74e95aae-e397-44cc-9005-d964c97ebc41',
        ),
      ],
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'text/plain',
        messageBody: 'Not Found',
      }),
    });

    // ─── Helper: Create ECS Fargate Service with auto-scaling ──────────
    const createService = (
      name: string,
      opts: {
        containerName: string;
        cpu: number;
        memoryMiB: number;
        imageTag: string;
        pathPattern?: string[];
        priority?: number;
        healthCheckPath: string;
        environmentOverrides?: Record<string, string>;
      },
    ) => {
      const taskDef = new ecs.FargateTaskDefinition(this, `${name}Task`, {
        cpu: opts.cpu,
        memoryLimitMiB: opts.memoryMiB,
        taskRole,
        executionRole,
      });

      const container = taskDef.addContainer(opts.containerName, {
        image: ecs.ContainerImage.fromEcrRepository(repository, opts.imageTag),
        logging: ecs.LogDrivers.awsLogs({
          logGroup,
          streamPrefix: opts.containerName,
        }),
        environment: { ...commonEnvironment, ...opts.environmentOverrides },
        secrets: commonSecrets.reduce(
          (acc, _secret, i) => {
            const names = [
              'DATABASE_URL',
              'TELEGRAM_BOT_TOKEN',
              'ENCRYPTION_KEY',
              'SECRET_KEY',
              'ADMIN_API_KEY',
              'LIFI_API_KEY',
              'ADMIN_IDS',
            ];
            acc[names[i]] = commonSecrets[i];
            return acc;
          },
          {} as Record<string, ecs.Secret>,
        ),
        healthCheck: {
          command: [
            'CMD-SHELL',
            `curl -f http://localhost:10000${opts.healthCheckPath} || exit 1`,
          ],
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
          startPeriod: cdk.Duration.seconds(60),
        },
        portMappings: [
          { containerPort: 10000, protocol: ecs.Protocol.TCP },
        ],
      });

      const service = new ecs.FargateService(this, `${name}Service`, {
        cluster,
        taskDefinition: taskDef,
        desiredCount: minCapacity,
        securityGroups: [ecsSecurityGroup],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assignPublicIp: false,
        circuitBreaker: { rollback: true },
      });

      // Auto-scaling
      const scaling = service.autoScaleTaskCount({
        minCapacity,
        maxCapacity,
      });

      scaling.scaleOnCpuUtilization(`${name}CpuScaling`, {
        targetUtilizationPercent: 70,
        scaleInCooldown: cdk.Duration.seconds(300),
        scaleOutCooldown: cdk.Duration.seconds(60),
      });

      scaling.scaleOnMemoryUtilization(`${name}MemoryScaling`, {
        targetUtilizationPercent: 80,
        scaleInCooldown: cdk.Duration.seconds(300),
        scaleOutCooldown: cdk.Duration.seconds(60),
      });

      // ALB target group (if path patterns provided)
      if (opts.pathPattern && opts.priority) {
        const targetGroup = httpsListener.addTargets(`${name}Target`, {
          port: 10000,
          protocol: elbv2.ApplicationProtocol.HTTP,
          targets: [service],
          priority: opts.priority,
          conditions: [
            elbv2.ListenerCondition.pathPatterns(opts.pathPattern),
          ],
          healthCheck: {
            path: opts.healthCheckPath,
            interval: cdk.Duration.seconds(30),
            timeout: cdk.Duration.seconds(5),
            healthyThresholdCount: 2,
            unhealthyThresholdCount: 3,
          },
        });
      }

      return service;
    };

    // ─── Bot Service ───────────────────────────────────────────────────
    const botService = createService('Bot', {
      containerName: 'suwappu',
      cpu: 512,
      memoryMiB: 1024,
      imageTag: 'latest',
      pathPattern: ['/telegram/*', '/webhook'],
      priority: 10,
      healthCheckPath: '/health',
    });

    // ─── API-TS Service ────────────────────────────────────────────────
    const apiTsService = createService('ApiTs', {
      containerName: 'suwappu-api-ts',
      cpu: 512,
      memoryMiB: 1024,
      imageTag: 'api-ts-latest',
      pathPattern: ['/v1/*', '/webapp/*', '/health/api-ts'],
      priority: 20,
      healthCheckPath: '/health',
      environmentOverrides: {
        SERVICE_NAME: 'api-ts',
      },
    });

    // ─── Webapp Service ────────────────────────────────────────────────
    const webappService = createService('Webapp', {
      containerName: 'suwappu-webapp',
      cpu: 256,
      memoryMiB: 512,
      imageTag: 'webapp-latest',
      pathPattern: ['/*'],
      priority: 100, // Lowest priority = catch-all
      healthCheckPath: '/health',
      environmentOverrides: {
        SERVICE_NAME: 'webapp',
      },
    });

    // ─── WAF ───────────────────────────────────────────────────────────
    const waf = new wafv2.CfnWebACL(this, 'SuwappuWaf', {
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
              aggregateKeyType: 'IP',
              limit: 2000,
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
      resourceArn: alb.loadBalancerArn,
      webAclArn: waf.attrArn,
    });

    // ─── SNS Alerts ────────────────────────────────────────────────────
    const alertTopic = new sns.Topic(this, 'SuwappuAlerts', {
      topicName: 'suwappu-alerts',
    });

    // ─── CloudWatch Alarms ─────────────────────────────────────────────
    new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_5XX_Count',
        dimensionsMap: {
          LoadBalancer: alb.loadBalancerFullName,
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 10,
      evaluationPeriods: 1,
      alarmDescription: 'ALB 5xx errors > 10 in 5 minutes',
      actionsEnabled: true,
    }).addAlarmAction({ bind: () => ({ alarmActionArn: alertTopic.topicArn }) });

    new cloudwatch.Alarm(this, 'RdsCpuAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          DBInstanceIdentifier: database.instanceIdentifier,
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 80,
      evaluationPeriods: 2,
      alarmDescription: 'RDS CPU utilization > 80%',
      actionsEnabled: true,
    }).addAlarmAction({ bind: () => ({ alarmActionArn: alertTopic.topicArn }) });

    new cloudwatch.Alarm(this, 'RdsFreeStorageAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'FreeStorageSpace',
        dimensionsMap: {
          DBInstanceIdentifier: database.instanceIdentifier,
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Average',
      }),
      threshold: 5 * 1024 * 1024 * 1024, // 5 GB
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'RDS free storage < 5 GB',
      actionsEnabled: true,
    }).addAlarmAction({ bind: () => ({ alarmActionArn: alertTopic.topicArn }) });

    // ─── Outputs ───────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      description: 'Load Balancer DNS Name',
      value: alb.loadBalancerDnsName,
      exportName: 'SuwappuLoadBalancerDns',
    });

    new cdk.CfnOutput(this, 'EcrRepositoryUri', {
      description: 'ECR Repository URI',
      value: repository.repositoryUri,
      exportName: 'SuwappuEcrUri',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      description: 'ECS Cluster Name',
      value: cluster.clusterName,
      exportName: 'SuwappuClusterName',
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      description: 'RDS Database Endpoint',
      value: database.dbInstanceEndpointAddress,
      exportName: 'SuwappuDatabaseEndpoint',
    });

    new cdk.CfnOutput(this, 'SecretsArn', {
      description: 'Secrets Manager ARN for app secrets',
      value: appSecrets.secretArn,
      exportName: 'SuwappuSecretsArn',
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      description: 'SNS Topic ARN for alerts (subscribe your email)',
      value: alertTopic.topicArn,
      exportName: 'SuwappuAlertTopicArn',
    });
  }
}
