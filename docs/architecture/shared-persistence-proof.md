# AI Scholar Hub — Shared Persistence Proof

## Objective

Prove that Azure Container Apps and a fallback compute runtime can use the same
external persistent data plane without moving data during failover.

Warm PROD remains untouched and authoritative during this proof.

## Proof stages

1. Inventory current persistence.
2. Provision isolated Azure proof resources.
3. Restore/copy production-like data into isolated Azure resources.
4. Run isolated ACA/canary compute against Azure persistence.
5. Run a second fallback canary against the same persistence.
6. Prove cross-compute read/write visibility.
7. Prove RAG retrieval equivalence.
8. Prove backup/restore.
9. Prove search-index rebuild.
10. Measure latency and cost.
11. Review results before any production cutover.

## Safety rules

- Warm PROD remains online.
- No proof process writes to live PROD databases.
- No production connection string is replaced.
- No destructive testing uses real user records.
- Synthetic tenant/users are used for write tests.
- Azure shadow data is non-authoritative until formal cutover.
- No local database is removed during the proof.

## Release I Proof Results

### Objective

Prove that AI Scholar Hub compute can fail over between Azure Container Apps and the warm VM while authoritative persistent state remains shared and does not move during compute failover.

Tester-facing warm PROD was not modified during these proofs.

### Azure PostgreSQL / pgvector

Provisioned an isolated Azure Database for PostgreSQL Flexible Server:

- Server: `aih-pg-proof`
- Region: Central India
- PostgreSQL: 15
- SKU: Standard_B2s
- Storage: 32 GiB with auto-grow
- Private delegated subnet: `snet-aih-pg-proof`
- Private DNS zone: `aih-proof.postgres.database.azure.com`
- Private address observed: `10.1.5.4`
- pgvector: 0.8.2

Migrated the DEV vector store into isolated database `aih_rag_proof`.

Parity results:

- DEV collections: 1
- Azure collections: 1
- DEV embeddings: 24
- Azure embeddings: 24
- LangChain collection and embedding schemas restored
- expected indexes restored
- foreign key restored
- nearest-neighbor retrieval ordering and cosine distances matched DEV exactly

An isolated RAG canary using the existing RAG image successfully initialized against Azure PostgreSQL and performed an authenticated retrieval against the migrated vectors.

### Private DNS / Container Networking Finding

The VM correctly used Azure DNS (`168.63.129.16`), but Docker daemon configuration forced containers to public resolvers:

- 8.8.8.8
- 1.1.1.1

These cannot resolve Azure Private DNS zones.

For the DEV proof, `systemd-resolved` was exposed on DEV bridge address `172.19.0.1` using `DNSStubListenerExtra`, and the canary used that resolver.

Confirmed path:

`DEV container -> Docker DNS -> 172.19.0.1 -> Azure Private DNS -> Azure PostgreSQL private IP`

Do not rely on fixed PostgreSQL private IPs in production. Production runtime configuration must use private DNS.

### RAG Mongo Credential Drift Found and Fixed

During the RAG canary test, Mongo-backed file authorization failed because the RAG container had stale Mongo credentials while the API had the current credentials.

Root cause:

Some Compose services reconstructed `MONGO_URI` from initialization variables rather than consuming the canonical `MONGO_URI`.

Source correction:

- model-router: use `${MONGO_URI}`
- admin-ui: use `${MONGO_URI}`
- canonical `.env` Mongo URI synchronized with the working API URI

The DEV `rag_api` was recreated and authenticated successfully:

- Database: LibreChat
- files collection: 13

This was a pre-existing configuration defect discovered during Release I testing.

### Azure Blob Storage

Used existing Azure Storage account `aihprodfc68138b`.

Created isolated proof container:

`aih-release-i-proof`

A synthetic 39-byte object was written from the VM, downloaded again on the VM, and then independently read from an Azure Container Apps workload.

SHA-256 from VM and ACA matched exactly:

`f28a79941ccbb8fc0adde15ecb4dbcb813ba896842753d227a5ed86be61b1151`

This proves both compute planes can access the same canonical Blob object without copying data during failover.

### MongoDB Atlas on Azure

Created isolated Atlas project:

- Project: `AIH-Release-I-Proof`
- Project ID: `6aaa0e49e19bd16ef9cf6fe0`

Created cluster:

- Cluster: `aih-release-i-mongo`
- Provider: Azure
- Region: Central India
- MongoDB: 8.0.32
- Tier: M0 / proof tier

DEV Mongo baseline:

- collections: 73
- objects: 1,347
- indexes: 407

The DEV Mongo snapshot restored successfully into Atlas.

Post-restore parity:

- collections: 73
- objects: 1,347
- indexes: 407
- users: 11
- institutions: 2
- groups: 2
- files: 13
- conversations: 39
- messages: 244
- agents: 3
- academicAgents: 28
- supportknowledges: 11

Cross-compute persistence proof:

1. VM wrote synthetic document:
   `release-i-20260916T035434Z`
2. Atlas persisted it.
3. ACA independently read the same document and values.

This proves shared Mongo application state can remain authoritative while compute moves between VM and ACA.

### Architecture Proven

Release I proves the intended shared-data architecture:

- MongoDB Atlas on Azure: authoritative application state
- Azure PostgreSQL + pgvector: authoritative RAG/vector state
- Azure Blob Storage: authoritative uploaded/document objects
- Meilisearch: derived/rebuildable search state
- VM and ACA: replaceable compute planes

Persistent data does not need to move during compute failover.

### Remaining Work Before Production Cutover

Release I is an architecture proof, not a production migration.

Required next steps include:

- production-grade private connectivity for MongoDB Atlas
- production-tier sizing and HA decisions
- production Blob authorization using managed identity/RBAC rather than account keys
- canonical Docker/ACA private-DNS configuration
- backup and restore drills
- RTO/RPO targets
- scheduled/background-job ownership and distributed lease
- Meilisearch rebuild procedure
- production migration manifests and rollback procedures
- credential rotation and Key Vault integration
- staged cutover with verification before local persistent services are retired
