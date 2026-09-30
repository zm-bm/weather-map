# AWS Cost Reduction Notes

Last updated: 2026-06-27

These notes are based on the June 2026 cost export and the current Terraform
shape across weather-map, gametree, and the shared infra repo. The big runaway
looks fixed already: costs dropped from about `$26/day` on June 18-20 to about
`$5/day` on June 21-26. The current work is mostly about trimming steady burn
and making sure a bad ingest loop does not quietly get expensive again.

## Best Bets

### 1. Filter MRMS Before SQS and Lambda

This is the best weather-map-specific target. The MRMS path subscribes to the
NOAA MRMS SNS topic, sends notifications through SQS, and filters object keys
inside the ingest Lambda. The app only needs two MRMS products right now, so a
large unfiltered notification stream can burn SQS requests, Lambda invocations,
S3 checks, and log bytes before most messages are skipped.

Try this first:

- add an SNS subscription filter for the two MRMS product paths, if the NOAA
  message body shape supports it cleanly
- if SNS body filtering is too awkward, replace the firehose subscription with
  a small scheduled poller that checks the exact product prefixes
- keep the existing frame-claim logic so duplicate product notifications still
  collapse into one worker job

Watch:

- SQS messages received/deleted
- Lambda invocations and duration for MRMS ingest
- Batch jobs submitted for MRMS
- missing or delayed MRMS frames in the published manifest

### 2. Decide Whether Gametree Should Stay Always-On

Some steady cost is shared or from gametree, not weather-map. Gametree currently
has a `t3.small` ASG with one desired instance behind the shared ALB, plus a
root EBS volume and public IPv4 usage. That is fine if the API needs to be live,
but it is a noticeable fixed cost for a demo.

Options:

- keep it as-is if the always-on demo is worth the monthly spend
- scale it to zero when not actively using or showing it
- schedule uptime windows
- eventually move the tiny public API surface to a cheaper/serverless shape

This is probably a larger lever than shaving small CloudWatch or S3 storage
costs.

### 3. Revisit the Shared ALB Only If Both Apps Can Avoid It

The shared infra stack has one public ALB routing weather-map and gametree. The
weather-map backend is already a small Lambda, but it is exposed through the ALB
path. Removing weather-map from the ALB only saves money if the ALB can go away
entirely, or if gametree also moves off it.

Reasonable alternatives:

- Lambda Function URL behind CloudFront for tiny read-only APIs
- API Gateway for a more conventional serverless API edge
- keep the ALB while gametree needs an instance target

Do not spend much time here unless the goal is to reduce fixed monthly cost
below the current post-fix run-rate.

### 4. Trim ETL Workload Only If The Run-Rate Is Still Too High

Fargate Spot is already the right basic choice for the Batch workers. To make
ETL materially cheaper, the app has to process less work:

- fewer forecast hours
- fewer generated artifacts
- fewer enabled datasets
- optional or lower-frequency MRMS

This is a product tradeoff, not just an infra tweak. Keep the current workload
if the app value is worth roughly the current spend.

### 5. Keep Storage and Logs Boring

Artifact lifecycle rules already exist, including short MRMS run retention.
Batch logs also have retention. There are still small hygiene wins:

- add explicit retention for Lambda-created log groups
- delete stale EBS snapshots and unused volumes
- keep CloudFront access log retention short unless actively analyzing traffic

These are worth doing, but they are not the main cost drivers after the ingest
fix.

## Things Not Worth Prioritizing Yet

- cache pre-warming: it would add request activity, and CloudFront is not the
  current cost center
- moving Batch workers into private subnets just to avoid public IPv4: NAT would
  likely cost more for this hobby-sized setup
- predictive encoding or exotic payload compression before geo-chunking: useful
  later, but not the first cost lever

## Guardrails

- Add AWS Budgets or Cost Anomaly Detection for daily and monthly spend.
- Activate cost allocation tags for `Stack`, `app`, and project ownership so
  weather-map, gametree, and shared-edge costs are easier to split.
- For any cost fix, compare a few full days before and after the change. One
  partial day can be misleading.
