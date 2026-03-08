module.exports = {
  apps: [
    {
      name: 'suwappu-api',
      cwd: './api-ts',
      script: 'bun',
      args: 'run src/index.ts',
      interpreter: 'none',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 100,
      error_file: '../logs/api-error.log',
      out_file: '../logs/api-out.log',
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'development',
        PORT: 8000
      }
    },
    {
      name: 'suwappu-webapp',
      cwd: './webapp',
      script: './node_modules/.bin/vite',
      args: '--host',
      interpreter: '/home/superposition/.nvm/versions/node/v23.9.0/bin/node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      exp_backoff_restart_delay: 100,
      error_file: '../logs/webapp-error.log',
      out_file: '../logs/webapp-out.log',
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'development'
      }
    }
  ]
};
