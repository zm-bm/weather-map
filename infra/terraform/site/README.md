# Weather Map site infrastructure

This Terraform root owns the Weather Map static site module instance for
`weather.zmbm.dev`.

The reusable static-site module remains in the shared infra repo and is sourced
from GitHub:

```hcl
source = "git::ssh://git@github.com/zm-bm/infra.git//modules/static-site?ref=e3a8f4cce5d826dc32f0104898d6c09d3189865d"
```

The backend state key is:

```text
weather-map/site.tfstate
```

The old shared stack lives in the sibling infra repo at
`stacks/static-sites` and stores state at `static-sites/prod.tfstate`.

## Run Terraform

```bash
cd infra/terraform/site
AWS_PROFILE=admin AWS_SDK_LOAD_CONFIG=1 terraform init
AWS_PROFILE=admin AWS_SDK_LOAD_CONFIG=1 terraform plan -no-color
```

This stack has no root input variables. The Weather Map site configuration is
declared directly in `main.tf`.

## Logging

CloudFront access logging, Athena, Glue, and dashboard resources are owned by
this stack as root resources. They intentionally remain project-specific for
now instead of being generalized into the reusable static-site module.

## Migration Notes

This root intentionally flattened the old keyed module instance:

```text
old: module.static_site["weather_map"]
new: module.static_site
```

The module state was moved from the shared `static-sites/prod.tfstate` state to
this root's `weather-map/site.tfstate` state under the new `module.static_site`
address.

The old shared stack no longer owns the `weather_map` site module instance or
its CloudFront logging resources.

## Outputs

Use:

```bash
terraform output -json sites
```

For the `weather_map` entry, the deployment workflow needs:

- `bucket_name`
- `distribution_id`
- `distribution_domain_name`
- `deploy_role_arn`
