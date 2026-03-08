export interface DeploymentConfig {
  name: string;
  environment: 'development' | 'staging' | 'production';
  provider: 'ec2' | 'ecs-fargate' | 'render';
  region: string;
  awsProfile?: string;

  // EC2 config (when provider = 'ec2')
  ec2?: {
    host: string;
    user: string;
    sshKeyPath: string;
    serviceName: string;
    appDir: string;
  };

  // ECS Fargate config
  fargate?: {
    clusterName: string;
    serviceName: string;
    taskDefinitionFamily: string;
    logGroup: string;
    logStreamPrefix: string;
    targetGroupArn?: string;
  };

  // RDS config
  rds?: {
    instanceId: string;
    engine: string;
    endpoint: string;
  };

  // Endpoints
  endpoints: {
    api: string;
    health: string;
  };

  // GitHub Actions
  github?: {
    repo: string;
    branch: string;
    workflowFile: string;
  };
}

export interface ContainerStatus {
  name: string;
  status: string;
  healthy: boolean;
  cpu?: string;
  memory?: string;
}

export interface EcsServiceStatus {
  serviceName: string;
  status: string;
  desiredCount: number;
  runningCount: number;
  pendingCount: number;
  taskDefinition: string;
}

export interface EcsTask {
  taskArn: string;
  taskId: string;
  lastStatus: string;
  desiredStatus: string;
  healthStatus: string;
  cpu: string;
  memory: string;
  createdAt: string;
  startedAt: string | null;
}

export interface RdsStatus {
  instanceId: string;
  status: string;
  engine: string;
  endpoint: string;
  multiAz: boolean;
}

export interface Ec2ServiceStatus {
  systemdActive: string;
  systemdSub: string;
  uptime: string | null;
  pid: number | null;
  memoryUsage: string | null;
  cpuUsage: string | null;
  gitBranch: string | null;
  gitCommit: string | null;
}

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'unreachable' | 'unknown';
  responseTime: number | null;
  lastCheck: Date | null;
  statusCode?: number;
  version?: string;
  service?: string;
  bot?: string;
  database?: string;
}

export interface CloudWatchLogEvent {
  timestamp: number;
  message: string;
  ingestionTime: number;
}

export interface EnvironmentStatus {
  service?: EcsServiceStatus | null;
  tasks?: EcsTask[];
  ec2?: Ec2ServiceStatus | null;
  rds: RdsStatus | null;
  health: HealthCheckResult;
  lastUpdated: Date;
  isLoading: boolean;
  error: string | null;
}
