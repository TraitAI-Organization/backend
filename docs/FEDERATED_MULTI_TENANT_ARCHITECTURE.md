# Federated Multi-Tenant Architecture (Sorghum Platform)

## 1) Context and Goal

This document defines a next-generation architecture for Nutrition AI with:
- multiple tenants (beyond platform admin)
- privacy-preserving/federated training
- shared aggregate model usage for enterprise buyers
- strict protection of farmer personal and farm-identifiable data

Target customers and needs:

| Customer | Primary Need | Data Access Pattern |
|---|---|---|
| Sorghum producers (farmers) | Better decisions for yield/nutrition and full visibility into their own records | Can see and manage own data only |
| Sorghum checkoff (grower organization) | Program-level insights, adoption metrics, benchmarking across members | Aggregated/anonymized program views; no raw PII exposure |
| General Mills (enterprise buyer) | Reliable, consistent yield and nutrition outcomes for supply planning | Consume aggregate model outputs and enterprise KPIs, no personal data |

## 2) Design Principles

- Tenant isolation first: each tenant has strict data boundaries.
- Privacy by default: PII separated and minimized.
- Federated-by-design: raw tenant data remains in tenant boundary during training.
- Aggregate value delivery: enterprise gets global model intelligence, not individual records.
- Auditability: every data access, model round, and deployment is traceable.

## 3) Proposed Logical Architecture

### Customer Block Flow Diagram

```mermaid
flowchart LR
  subgraph CUST["Customer Blocks"]
    FARM["Sorghum Producers\n(Farmers)"]
    CHK["Sorghum Checkoff"]
    GM["General Mills"]
    ADMUSR["Platform Admin"]
  end

  subgraph PLATFORM["Nutrition AI Federated Platform"]
    IAM["Identity + Tenant Auth"]
    POLICY["Policy Engine\n(RBAC + ABAC)"]
    ORCH["Federated Orchestrator"]
    AGG["Secure Aggregation"]
    REG["Model Registry + Governance"]
    SERVE["Aggregate Model Serving API"]
    INS["Insights API\n(aggregate-safe only)"]
    AUD["Audit + Monitoring"]
  end

  FARM --> IAM
  CHK --> IAM
  GM --> IAM
  ADMUSR --> IAM

  IAM --> POLICY
  POLICY --> ORCH
  ORCH --> AGG
  AGG --> REG
  REG --> SERVE
  SERVE --> INS

  INS --> CHK
  INS --> GM
  REG --> AUD
  ORCH --> AUD
```

### Detailed Logical Architecture

```mermaid
flowchart LR
  subgraph T1["Tenant: Producer Organization / Farmer Group A"]
    AUI["Farmer App / Portal"]
    ADS["Tenant Data Store A\n(fields, management, outcomes)"]
    APII["PII Vault A\n(name, contact, identifiers)"]
    ATRL["Local Trainer A"]
  end

  subgraph T2["Tenant: Producer Organization / Farmer Group B"]
    BUI["Farmer App / Portal"]
    BDS["Tenant Data Store B"]
    BPII["PII Vault B"]
    BTRL["Local Trainer B"]
  end

  subgraph CP["Central Platform Control Plane"]
    IAM["AuthN/AuthZ + Tenant Policy Engine"]
    ORCH["Federated Orchestrator\n(round control, model distribution)"]
    SA["Secure Aggregation Service"]
    REG["Model Registry + Lineage"]
    FEAT["Global Feature Contracts"]
    INFER["Model Serving API"]
    OBS["Audit, Monitoring, Drift"]
    CHECK["Checkoff Insights API\n(aggregated only)"]
    ENT["Enterprise API (General Mills)\naggregate model + KPI"]
    ADM["Platform Admin Console"]
  end

  AUI --> IAM
  BUI --> IAM
  ATRL --> ORCH
  BTRL --> ORCH
  ORCH --> SA
  SA --> REG
  REG --> INFER
  FEAT --> ORCH
  INFER --> CHECK
  INFER --> ENT
  IAM --> ADM
  ORCH --> OBS
  SA --> OBS
  REG --> OBS
```

## 4) Data and Privacy Boundaries

### Data classes
- `PII`: farmer names, contacts, exact identifiers.
- `Tenant-sensitive`: field-level raw operations/outcomes that can identify a farm.
- `Aggregate-safe`: anonymized metrics, model weights/updates, cohort KPIs.

### Boundary rules
- PII stored in tenant-specific vault/storage only.
- Raw tenant datasets do not leave tenant boundary for training.
- Only encrypted model deltas/gradients are sent to the central aggregator.
- Enterprise and checkoff views consume aggregate outputs and thresholded cohorts only.

## 5) Tenant and Role Model

Core roles:
- `platform_admin`: operates platform, cannot casually read tenant PII.
- `tenant_admin`: manages users/config for one tenant.
- `farmer_user`: accesses only own farm/field data and recommendations.
- `checkoff_analyst`: accesses aggregated cross-member dashboards.
- `enterprise_analyst`: accesses aggregate model outputs and supply KPIs.

Access model:
- RBAC + ABAC (`tenant_id`, `organization_id`, `data_classification`, `purpose`).
- Policy decision point enforced on all APIs and query paths.

## 6) Federated Learning Lifecycle (Cross-Silo)

```mermaid
sequenceDiagram
  participant OR as Federated Orchestrator
  participant TA as Tenant Trainer A
  participant TB as Tenant Trainer B
  participant SA as Secure Aggregator
  participant MR as Model Registry
  participant SV as Serving API

  OR->>TA: Send round config + current global model
  OR->>TB: Send round config + current global model
  TA->>TA: Local training on tenant data only
  TB->>TB: Local training on tenant data only
  TA->>SA: Encrypted model update
  TB->>SA: Encrypted model update
  SA->>SA: Secure aggregate (+ optional DP/noise)
  SA->>MR: Publish aggregated candidate model
  MR->>MR: Validation + approval gate
  MR->>SV: Promote approved global model
```

## 7) Model Strategy

- Global aggregate model: used for checkoff and enterprise experiences.
- Optional tenant-personalized heads:
  - global backbone + tenant calibration layer
  - keeps local relevance without exposing raw local data.
- Release policy:
  - staging validation
  - bias/fairness and drift checks
  - controlled rollout (canary by tenant cohort)

## 8) Operational Controls

- Encryption in transit: TLS/mTLS between tenant trainers and orchestrator.
- Key management: KMS-backed key rotation for model artifacts and secrets.
- Audit trails:
  - model round participants
  - data access events
  - deployment and rollback events
- Safety thresholds:
  - minimum cohort size for aggregate reporting
  - k-anonymity style suppression on small groups

## 9) How This Maps to Current Nutrition AI

Current platform already has:
- model registry/versioning
- training and prediction services
- admin panel and operational workflows

New components to introduce:
- tenant-aware auth/policy layer
- tenant-scoped data partitions and PII vault separation
- federated orchestrator + secure aggregation service
- aggregate-only enterprise/checkoff APIs

## 10) Decision Record (Recommended Defaults)

- Federation mode: cross-silo FL (tenant organizations as training silos).
- Storage isolation: start with schema-per-tenant, move high-sensitivity tenants to DB-per-tenant.
- Privacy enhancement: secure aggregation required; differential privacy enabled for enterprise aggregates.
- Model output policy: no per-farm predictions exposed to enterprise tenants.
