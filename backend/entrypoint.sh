#!/bin/sh
set -eu
npm run db:migrate -w @medcore/api
npm run db:seed -w @medcore/api
exec npm run start -w @medcore/api
