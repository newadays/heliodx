# Settings for the GPU service scripts (deploy.sh, stage-weights.sh).
# Copy to env.sh and fill in your own values: cp env.example.sh env.sh
# env.sh is gitignored; nothing here is a secret, but it describes your
# infrastructure, so it stays out of the public repo.
PROJECT="${PROJECT:-your-gcp-project-id}"
PROJECT_NUMBER="${PROJECT_NUMBER:-000000000000}"
REGION="${REGION:-your-gpu-region}"              # a Cloud Run region with RTX PRO 6000 GPUs
SERVICE="${SERVICE:-heliodx-models}"
BUCKET="${BUCKET:-your-model-weights-bucket}"    # single-region, same region as the service
REPO="${REPO:-heliodx}"                          # Artifact Registry (Docker)
SA_NAME="${SA_NAME:-heliodx-models}"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
VPC="${VPC:-heliodx-vpc}"
SUBNET="${SUBNET:-heliodx-gpu-subnet}"
SUBNET_RANGE="${SUBNET_RANGE:-10.10.0.0/24}"
# The Cloud Functions runtime service account; the only caller allowed.
INVOKER_SA="${INVOKER_SA:-${PROJECT_NUMBER}-compute@developer.gserviceaccount.com}"
# Cloud Build machine. Empty = the default machine, which new projects can
# always use; larger types (E2_HIGHCPU_8/32) need regional quota.
CB_MACHINE="${CB_MACHINE:-}"
GLIMMER_REPO="meta-models/Muse-Glimmer-30B"
SAM_REPO="facebook/sam3.1"
