#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SuwappuStack } from '../lib/suwappu-stack';

const app = new cdk.App();

// Get environment from context or use defaults
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
};

new SuwappuStack(app, 'SuwappuStack', {
  env,
  description: 'Suwappu Bot - Telegram trading bot infrastructure',
  
  // Stack-level tags
  tags: {
    Project: 'Suwappu',
    Environment: 'production',
    ManagedBy: 'CDK',
  },
});

app.synth();
