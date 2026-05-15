FROM 905418423235.dkr.ecr.us-east-1.amazonaws.com/suwappu:latest

USER root
WORKDIR /app

COPY --chown=botuser:botuser api/main.py /app/api/main.py
COPY --chown=botuser:botuser api/webapp.py /app/api/webapp.py
COPY --chown=botuser:botuser api/routes/terminal.py /app/api/routes/terminal.py

USER botuser
