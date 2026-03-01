import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export class SuwappuStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: ecs.Cluster;
  public readonly database: rds.DatabaseInstance;

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

    // NOTE: Only an S3 Gateway VPC endpoint is deployed (free, created via CLI:
    // vpce-0d70a05ed12a18056). Interface endpoints were removed — NAT data
    // transfer is only ~$1/mo, far less than the ~$29/mo interface endpoint cost.

    // ==================== Security Groups ====================
    // ALB security group — used by consolidated ALB (suwappu-alb) managed
    // outside CDK. Host-based routing serves app.suwappu.bot,
    // devfront.suwappu.bot, and www.suwappu.bot from a single ALB.
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

    // ==================== ElastiCache Redis ====================
    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for ElastiCache Redis',
      allowAllOutbound: false,
    });
    redisSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow Redis from ECS'
    );

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Suwappu Redis',
      subnetIds: this.vpc.isolatedSubnets.map(s => s.subnetId),
      cacheSubnetGroupName: 'suwappu-redis-subnets',
    });

    const redisCluster = new elasticache.CfnCacheCluster(this, 'SuwappuRedis', {
      clusterName: 'suwappu-redis',
      engine: 'redis',
      cacheNodeType: 'cache.t4g.micro',
      numCacheNodes: 1,
      engineVersion: '7.1',
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
    });
    redisCluster.addDependency(redisSubnetGroup);

    // ==================== SQS Trade Queue ====================
    const tradeDLQ = new sqs.Queue(this, 'TradeDLQ', {
      queueName: 'suwappu-trade-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    const tradeQueue = new sqs.Queue(this, 'TradeQueue', {
      queueName: 'suwappu-trade-queue',
      visibilityTimeout: cdk.Duration.seconds(120),
      retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: tradeDLQ,
        maxReceiveCount: 3,
      },
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

    // ==================== ECR Repository (Showcase) ====================
    // Showcase repo exists in AWS but is not in CloudFormation state.
    // Reference it by name to avoid create conflict.
    const showcaseRepository = ecr.Repository.fromRepositoryName(
      this, 'SuwappuShowcaseRepository', 'suwappu-showcase'
    );

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

    // NOTE: ALB, certificate, listeners, WAF, and WAF-ALB association removed
    // from CDK. A single consolidated ALB (suwappu-alb) with host-based routing
    // is managed outside CDK, serving all frontend services.

    // ==================== CloudWatch Alarms + SNS ====================
    const alertTopic = new sns.Topic(this, 'SuwappuAlerts', {
      topicName: 'suwappu-alerts',
    });

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

    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: redisCluster.attrRedisEndpointAddress,
      description: 'ElastiCache Redis Endpoint',
      exportName: 'SuwappuRedisEndpoint',
    });

    new cdk.CfnOutput(this, 'ShowcaseEcrRepositoryUri', {
      value: showcaseRepository.repositoryUri,
      description: 'Showcase ECR Repository URI',
      exportName: 'SuwappuShowcaseEcrUri',
    });

    new cdk.CfnOutput(this, 'TradeQueueUrl', {
      value: tradeQueue.queueUrl,
      description: 'SQS Trade Queue URL',
    });

    new cdk.CfnOutput(this, 'TradeDLQUrl', {
      value: tradeDLQ.queueUrl,
      description: 'SQS Trade Dead Letter Queue URL',
    });
  }
}
