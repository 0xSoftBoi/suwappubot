# ✅ Deployment Checklist

Use this checklist to ensure a smooth deployment.

## Pre-Deployment

### 1. Environment Configuration
- [ ] Copy `env.example` to `.env`
- [ ] Set `TELEGRAM_BOT_TOKEN` (from @BotFather)
- [ ] Generate and set `ENCRYPTION_KEY` (run `./deploy.sh keygen`)
- [ ] Configure `DATABASE_URL` (PostgreSQL for production)
- [ ] Set all RPC URLs (use paid providers for production)
- [ ] Set `ADMIN_IDS` (comma-separated Telegram user IDs)
- [ ] Configure `FEE_COLLECTOR_ADDRESS` (your wallet address)
- [ ] Set `DB_PASSWORD` (if using Docker with PostgreSQL)
- [ ] (Optional) Set `LIFI_API_KEY` for higher rate limits
- [ ] (Optional) Set `REDIS_URL` for caching

### 2. Security
- [ ] `.env` file is NOT committed to git (check `.gitignore`)
- [ ] Encryption key is 64 characters and securely stored
- [ ] Database password is strong and unique
- [ ] RPC endpoints use API keys (not public endpoints)
- [ ] Admin IDs are correct and trusted

### 3. Infrastructure
- [ ] Server/VPS provisioned (1GB+ RAM, 1+ vCPU)
- [ ] Docker installed (if using Docker deployment)
- [ ] PostgreSQL installed (if using PostgreSQL)
- [ ] Firewall configured (only necessary ports open)
- [ ] Domain/SSL configured (if using webhooks)

## Deployment Steps

### Option A: Docker Deployment

- [ ] Run `./deploy.sh check` - all checks pass
- [ ] Run `./deploy.sh docker` - deployment succeeds
- [ ] Verify: `docker-compose ps` - all services running
- [ ] Check logs: `docker-compose logs bot` - no errors
- [ ] Test bot in Telegram - responds to commands

### Option B: systemd Deployment

- [ ] Run `./deploy.sh venv` - virtual environment created
- [ ] Run `./deploy.sh check` - all checks pass
- [ ] Run `sudo ./deploy.sh systemd` - service created
- [ ] Verify: `sudo systemctl status suwappubot` - active
- [ ] Check logs: `sudo journalctl -u suwappubot` - no errors
- [ ] Test bot in Telegram - responds to commands

## Post-Deployment

### 1. Initial Setup
- [ ] Bot responds to `/start` command
- [ ] Test wallet creation (self-custody)
- [ ] Test balance check
- [ ] Test swap functionality (small test swap)
- [ ] Verify database tables created correctly

### 2. Admin Configuration
- [ ] Access admin commands (`/admin`)
- [ ] Create hot wallets for deposits (`/admin hot_wallet create`)
- [ ] Configure gas sponsorship (`/admin paymaster setup`)
- [ ] Set up fee collection address
- [ ] Test admin metrics (`/admin metrics`)

### 3. Monitoring
- [ ] Set up log monitoring (journalctl/Docker logs)
- [ ] Configure uptime monitoring (UptimeRobot, etc.)
- [ ] Set up database backups
- [ ] Monitor error rates and performance
- [ ] Set up alerts for critical errors

### 4. Production Hardening
- [ ] Enable Redis caching (if not already)
- [ ] Configure rate limiting
- [ ] Set up automated backups
- [ ] Review and update security settings
- [ ] Document recovery procedures

## Testing Checklist

### Basic Functionality
- [ ] `/start` - Shows welcome message
- [ ] `/help` - Shows help menu
- [ ] Wallet creation (self-custody)
- [ ] Balance check
- [ ] Token list display
- [ ] Chain selection

### Swap Functionality
- [ ] Get swap quotes
- [ ] Execute small test swap
- [ ] Verify transaction on blockchain
- [ ] Check swap history
- [ ] Test different chains

### Advanced Features
- [ ] Price alerts
- [ ] Limit orders
- [ ] DCA orders
- [ ] Referral system
- [ ] Tax export
- [ ] 2FA for large swaps

### Admin Features
- [ ] Admin metrics dashboard
- [ ] Fee collection
- [ ] Hot wallet management
- [ ] Gas sponsorship
- [ ] User management

## Troubleshooting

### Common Issues

**Bot not responding:**
- [ ] Check logs for errors
- [ ] Verify `.env` configuration
- [ ] Test RPC endpoints
- [ ] Check database connection

**Database errors:**
- [ ] Verify database is running
- [ ] Check connection string
- [ ] Ensure database exists
- [ ] Check permissions

**RPC rate limits:**
- [ ] Use paid RPC providers
- [ ] Enable Redis caching
- [ ] Check rate limit settings

**High memory usage:**
- [ ] Monitor memory usage
- [ ] Restart bot periodically
- [ ] Check for memory leaks
- [ ] Consider upgrading server

## Rollback Plan

If deployment fails:

1. **Docker:**
   ```bash
   docker-compose down
   git checkout <previous-commit>
   docker-compose up -d
   ```

2. **systemd:**
   ```bash
   sudo systemctl stop suwappubot
   git checkout <previous-commit>
   sudo systemctl start suwappubot
   ```

## Support

- Check logs first: `docker-compose logs` or `journalctl -u suwappubot`
- Review [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions
- Check [DEPLOYMENT_QUICKSTART.md](./DEPLOYMENT_QUICKSTART.md) for quick reference

---

**Ready to deploy?** Run `./deploy.sh check` to verify everything is configured correctly!

