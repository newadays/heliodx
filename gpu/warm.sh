#!/usr/bin/env bash
# Keeps one GPU instance running (on) or lets the service scale to zero (off),
# without rebuilding or redeploying the image. Judging week: on from Nov 4,
# off after Nov 9. A later ./deploy.sh resets this unless MIN_INSTANCES=1.
#
#   ./warm.sh on      # min instances 1: no cold start, billed every hour
#   ./warm.sh off     # min instances 0: scales to zero, ~5 min cold start
#   ./warm.sh status  # print the current setting
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -f ./env.sh ]; then
  echo "gpu/env.sh is missing: cp env.example.sh env.sh and fill in your project, region and bucket." >&2
  exit 2
fi
source ./env.sh

current() {
  local v
  v=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --format 'value(spec.template.metadata.annotations."autoscaling.knative.dev/minScale")')
  echo "${v:-0}"
}

case "${1:-status}" in
  on)  n=1 ;;
  off) n=0 ;;
  status) echo "min instances: $(current)"; exit 0 ;;
  *) echo "usage: ./warm.sh on|off|status" >&2; exit 2 ;;
esac

gcloud run services update "$SERVICE" --project "$PROJECT" --region "$REGION" --min-instances "$n"
echo "min instances: $(current)"
