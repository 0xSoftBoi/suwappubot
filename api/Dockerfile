FROM 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu:latest

USER root
WORKDIR /app

COPY --chown=botuser:botuser api/main.py /app/api/main.py
COPY --chown=botuser:botuser api/webapp.py /app/api/webapp.py
COPY --chown=botuser:botuser api/routes/terminal.py /app/api/routes/terminal.py
COPY --chown=botuser:botuser database/db.py /app/database/db.py
COPY --chown=botuser:botuser bot/main.py /app/bot/main.py
COPY --chown=botuser:botuser bot/models/__init__.py /app/bot/models/__init__.py
COPY --chown=botuser:botuser bot/models/user.py /app/bot/models/user.py
COPY --chown=botuser:botuser bot/models/tracking.py /app/bot/models/tracking.py
COPY --chown=botuser:botuser bot/services/copy_service.py /app/bot/services/copy_service.py
COPY --chown=botuser:botuser bot/services/orders.py /app/bot/services/orders.py
COPY --chown=botuser:botuser bot/services/swap_engine.py /app/bot/services/swap_engine.py

USER botuser
