import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class SuwappuStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly cluster: ecs.Cluster;
  public readonly database: rds.DatabaseInstance;
  public readonly service: ecs.FargateService;
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
      multiAz: false, // Cost optimization
      deletionProtection: true,
      backupRetention: cdk.Duration.days(7),
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
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'SuwappuTask', {
      memoryLimitMiB: 512,
      cpu: 256,
    });

    // Grant secrets access to task
    appSecrets.grantRead(taskDefinition.taskRole);
    this.database.secret?.grantRead(taskDefinition.taskRole);

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

    const listener = this.loadBalancer.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
    });

    // ==================== Fargate Service ====================
    this.service = new ecs.FargateService(this, 'SuwappuService', {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: 1,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      circuitBreaker: {
        rollback: true,
      },
      enableExecuteCommand: true, // For debugging
    });

    // Register with load balancer
    listener.addTargets('SuwappuTarget', {
      port: 10000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    // ==================== Auto Scaling ====================
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: 1,
      maxCapacity: 3,
    });

    scaling.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
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

    new cdk.CfnOutput(this, 'ServiceName', {
      value: this.service.serviceName,
      description: 'ECS Service Name',
      exportName: 'SuwappuServiceName',
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
  }
}
