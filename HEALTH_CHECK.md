# 🏥 Health Check Script

This document describes the health check functionality for the Suwappu Bot.

## Overview

The health check script (`health_check.py`) provides a comprehensive way to verify the health and status of all bot components before and during operation.

## Features

The health check verifies:

1. **Database Connectivity**
   - Connection status
   - User, wallet, and swap counts

2. **Configuration**
   - Telegram bot token
   - Encryption key (length validation)
   - Database URL

3. **Cache Systems**
   - Price cache
   - Quote cache
   - Balance cache
   - Gas cache

4. **RPC Endpoints**
   - Ethereum
   - BSC
   - Polygon
   - Arbitrum
   - Optimism
   - Base
   - Solana

5. **External APIs**
   - Li.Fi API
   - Jupiter API
   - CoinGecko API

## Usage

### Running the Health Check

#### Method 1: Direct Python Execution
```bash
# Activate virtual environment first
source venv/bin/activate

# Run health check
python health_check.py
```

#### Method 2: Using Deploy Script
```bash
# Run health check via deploy script
./deploy.sh health
```

#### Method 3: Check Command
```bash
# See all available commands
./deploy.sh check
```

### Exit Codes

- **0**: All checks passed or most checks passed (80%+)
- **1**: Some checks failed (< 80% passed)

### Example Output

```
========================================
Suwappu Bot Health Check
========================================
Started at: 2026-01-18 19:22:43 UTC

========================================
Database Health Check
========================================
✅ Database Connection: Connected (Users: 4, Wallets: 5, Swaps: 3)

========================================
Configuration Health Check
========================================
✅ Telegram Bot Token: Configured
✅ Encryption Key: Configured (64 chars)
✅ Database URL: Configured

========================================
Cache Systems Health Check
========================================
✅ Price Cache: 0 entries
✅ Quote Cache: 0 entries
✅ Balance Cache: 0 entries
✅ Gas Cache: 0 entries

========================================
RPC Endpoints Health Check
========================================
✅ ethereum RPC: OK (127ms)
✅ bsc RPC: OK (128ms)
✅ polygon RPC: OK (110ms)
✅ arbitrum RPC: OK (131ms)
✅ optimism RPC: OK (206ms)
✅ base RPC: OK (126ms)
✅ solana RPC: OK (126ms)

========================================
External APIs Health Check
========================================
✅ Li.Fi API: OK
✅ Jupiter API: OK
✅ CoinGecko API: OK

========================================
Health Check Summary
========================================

✅ Overall Status: All checks passed!
Duration: 1.25 seconds
Checks: 18/18 passed
```

## Integration with Monitoring

### Uptime Monitoring

You can integrate the health check with uptime monitoring services:

#### UptimeRobot
1. Create a new HTTP monitor
2. Point it to a local endpoint or use SSH tunneling
3. Set check interval (e.g., every 5 minutes)

#### Better Uptime
1. Create a new monitor
2. Configure to check the health endpoint
3. Set up alerting for failures

### Cron Jobs

Set up a cron job to run health checks periodically:

```bash
# Edit crontab
crontab -e

# Add this line to run health check every 15 minutes
*/15 * * * * /path/to/suwappubot/deploy.sh health >> /path/to/suwappubot/health_check.log 2>&1
```

### Systemd Service

Create a systemd timer to run health checks:

```bash
# Create a service file
sudo nano /etc/systemd/system/health-check.service
```

```ini
[Unit]
Description=Suwappu Bot Health Check

[Service]
Type=oneshot
ExecStart=/path/to/suwappubot/deploy.sh health
User=ubuntu
WorkingDirectory=/path/to/suwappubot

[Install]
WantedBy=multi-user.target
```

```bash
# Create a timer file
sudo nano /etc/systemd/system/health-check.timer
```

```ini
[Unit]
Description=Run Suwappu Bot Health Check every 15 minutes

[Timer]
OnCalendar=*-*-* *:0/15:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
# Enable and start the timer
sudo systemctl daemon-reload
sudo systemctl enable health-check.timer
sudo systemctl start health-check.timer

# Check status
sudo systemctl list-timers | grep health-check
```

## Troubleshooting

### Common Issues

#### Database Connection Failed
- Verify `DATABASE_URL` in `.env` is correct
- Check if PostgreSQL/MySQL service is running
- Verify network connectivity to the database server

#### RPC Endpoint Timeout
- Check your RPC provider credentials
- Verify network connectivity
- Consider using faster RPC providers (Alchemy, Infura, QuickNode)

#### API Connection Failed
- Check your internet connection
- Verify the API endpoint URLs are correct
- Check if you're being rate-limited

#### Encryption Key Invalid Length
- Generate a new key: `python -c "import secrets; print(secrets.token_hex(32))"`
- Ensure the key is exactly 64 characters (32 bytes in hex)

### Debugging

For more detailed debugging, run the health check with verbose output:

```bash
python -u health_check.py 2>&1 | tee health_check_debug.log
```

## Best Practices

1. **Run before deployment**: Always run health checks before deploying to production
2. **Monitor regularly**: Set up automated monitoring to catch issues early
3. **Alert on failures**: Configure alerts for when health checks fail
4. **Review logs**: Regularly review health check logs for trends and issues
5. **Test after changes**: Run health checks after configuration changes or updates

## Related Commands

- `/status` - Admin command to check bot status via Telegram
- `./deploy.sh test` - Run unit tests
- `./deploy.sh check` - Show all deployment options
