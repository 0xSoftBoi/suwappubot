export interface DeploymentConfig {
  name: string;
  environment: 'development' | 'staging' | 'production';
  provider: 'ecs-fargate' | 'render';
  region: string;
  awsProfile?: string;

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

export interface HealthCheckResult {
  status: 'healthy' | 'unhealthy' | 'unreachable' | 'unknown';
  responseTime: number | null;
  lastCheck: Date | null;
  statusCode?: number;
  version?: string;
  service?: string;
}

export interface CloudWatchLogEvent {
  timestamp: number;
  message: string;
  ingestionTime: number;
}

export interface EnvironmentStatus {
  service: EcsServiceStatus | null;
  tasks: EcsTask[];
  rds: RdsStatus | null;
  health: HealthCheckResult;
  lastUpdated: Date;
  isLoading: boolean;
  error: string | null;
}
