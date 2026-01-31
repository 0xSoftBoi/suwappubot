FROM postgres:15-alpine

RUN apk add --no-cache aws-cli bash

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

ENTRYPOINT ["/backup.sh"]
