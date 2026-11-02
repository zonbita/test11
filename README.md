# COMPTE BE — CRM Báo giá / Hóa đơn (multi-tenant SaaS)

NestJS 11 · Prisma 7 · PostgreSQL 17 (mỗi tenant một database) · Casbin RBAC · nestjs-pino.
Đặc tả: PRD/FS v0.1 (F01–F19). Mã AC/BR trong code và test tham chiếu tài liệu này.

## Chạy lần đầu

```bash
cp .env.example .env          # sinh DB_CREDENTIALS_KEY và JWT_SECRET thật (lệnh trong file)
npm install                   # tự chạy prisma generate cho 2 schema + cài husky
docker compose up -d          # PostgreSQL 17
npm run db:control:deploy     # migrate DB trung tâm
npm run db:control:seed       # gói dịch vụ + Super Admin + tenant "dfm" mặc định (hệ thống mới)
npm run db:tenants:deploy     # migrate mọi tenant + bổ sung tài khoản mặc định còn thiếu
npm run start:dev             # http://localhost:3000, Swagger: http://localhost:3000/docs
```

## Tài khoản mặc định

Mỗi vai trò có một tài khoản, mật khẩu `123456`, **ở mọi môi trường kể cả production** (quyết định của Product Owner,
ngoại lệ có chủ ý so với F02 BR-01). Khi khởi động, API log cảnh báo (warn) liệt kê các tài khoản còn dùng mật khẩu mặc định.

| Vai trò          | Email                          | Phạm vi                                    | Nơi tạo           |
| ---------------- | ------------------------------ | ------------------------------------------ | ----------------- |
| Super Admin      | `superadmin@platform.local`    | Nền tảng (control DB)                      | `db:control:seed` |
| Admin tenant     | `admin@<subdomain>.local`      | Toàn tenant (membership `company_id` null) | Mỗi tenant        |
| Chủ doanh nghiệp | `owner@<subdomain>.local`      | Pháp nhân đầu tiên                         | Mỗi tenant        |
| Kế toán          | `accountant@<subdomain>.local` | Pháp nhân đầu tiên                         | Mỗi tenant        |
| Sale             | `sales@<subdomain>.local`      | Pháp nhân đầu tiên                         | Mỗi tenant        |
| Người xem        | `viewer@<subdomain>.local`     | Pháp nhân đầu tiên                         | Mỗi tenant        |

- Hệ thống mới (chưa có tenant nào): `db:control:seed` (và job `migrate` của docker-compose) tạo Super Admin + tenant
  `dfm` (gói business, pháp nhân DFM-EUROPE) với đủ 5 tài khoản → `dfm.<APP_BASE_DOMAIN>`.
- Provision tenant mới và `db:tenants:deploy`: thêm tài khoản mặc định **còn thiếu** cho mọi tenant.
- Chỉ tạo khi chưa tồn tại: không ghi đè, không reset mật khẩu, không đổi vai trò của tài khoản đã có. Chạy lại bao nhiêu lần cũng được.
- Tài khoản mặc định ở trạng thái ACTIVE và tính vào giới hạn gói (starter: 10 user).
- Quy tắc mật khẩu ≥ 12 ký tự + không phổ biến chỉ áp khi tạo user / đổi mật khẩu qua API; login và seed không kiểm tra.
- Code: `src/modules/platform/tenants/default-accounts.ts`, `src/cli/seed-control.ts`, `src/cli/migrate-tenants.ts`.

Gọi API (JSON **snake_case**):

```bash
# Super Admin (domain gốc)
curl -X POST localhost:3000/platform/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"superadmin@platform.local","password":"123456"}'
curl -X POST localhost:3000/platform/api/v1/tenants -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"name":"Acme","subdomain":"acme","plan_code":"starter","company_legal_name":"ACME SAS",
       "admin_email":"boss@acme.fr","admin_full_name":"Boss","admin_password":"Boss-Password-2026"}'

# Tenant (subdomain)
curl -X POST http://dfm.localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@dfm.local","password":"123456"}'
curl http://dfm.localhost:3000/api/v1/customers -H "Authorization: Bearer <token>" -H "X-Company-Id: <company id>"
```

## Scripts

| Script                                       | Việc                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| `start:dev` / `build` / `start:prod`         | Chạy dev (watch) / build / chạy bản build                                |
| `lint`, `lint:fix`, `format`, `format:check` | ESLint (flat config, type-aware) + Prettier                              |
| `typecheck`                                  | `tsc --noEmit` cho src và test                                           |
| `test`                                       | Unit test (không cần DB)                                                 |
| `test:e2e`                                   | E2E trên PostgreSQL thật, hệ thống mới mỗi lần chạy (DB `*_e2e`, tự xóa) |
| `db:control:migrate` / `db:control:deploy`   | Tạo migration / áp migration DB trung tâm                                |
| `db:control:seed`                            | Build rồi seed: gói dịch vụ, Super Admin, tenant `dfm` nếu hệ thống mới  |
| `db:tenant:migrate -- --name x`              | Tạo migration schema tenant (trên DB dev `TENANT_DATABASE_URL`)          |
| `db:tenants:deploy [-- --tenant=dfm]`        | Build rồi migrate mọi tenant, đồng bộ quyền, thêm tài khoản mặc định     |

Pre-commit (husky + lint-staged): ESLint `--fix` + Prettier trên file đã stage.

## Cấu trúc thư mục

```
prisma/
  control/  schema.prisma (generator+datasource) · models/*.prisma · enums/*.prisma · migrations/
  tenant/   schema.prisma · models/*.prisma · enums/*.prisma · migrations/
            → MỖI MODEL / ENUM MỘT FILE. SQL Prisma không biểu diễn được (CHECK, trigger,
              NULLS NOT DISTINCT) viết tay ở cuối migration, có comment.
src/
  cli/           seed-control, migrate-tenants (build vào dist/cli, chạy được trong container)
  config/        env.validation.ts — validate env, từ chối khởi động production với secret mặc định
  common/        auth decorators · errors (AppException, mã lỗi) · filters · http (app setup, throttle)
                 · logging (pino options, request context) · validation (SIRET, IBAN, mật khẩu)
  database/      ControlPrismaService · TenantPrismaManager (pool/tenant) · ControlEventsService (LISTEN/NOTIFY)
  generated/     Prisma client (gitignored, sinh khi npm install)
  modules/
    tenancy/     subdomain → tenant → DB client (AsyncLocalStorage) · giới hạn gói
    auth/        login tenant, lockout, JWT + token version, kiểm tra user còn ACTIVE mỗi request
    rbac/        Casbin (model.conf, adapter Prisma, enforcer), guard, danh mục quyền, API vai trò
    platform/    Super Admin: login, tạo/retry/đổi trạng thái tenant, provisioning DB
    companies/   pháp nhân + thuế suất
    users/       người dùng, trạng thái, gán vai trò theo pháp nhân
    customers/   khách hàng, liên hệ, địa chỉ, chia sẻ (module mẫu cho các module nghiệp vụ sau)
    numbering/   cấp số liên tục (C00001, DEV/FAC/AV{YYYY}{NNNN})
    health/      /health/live, /health/ready
test/            e2e: platform, isolation, rbac, customers, default-accounts, http, throttle
                 (+ support/, setup/, fixtures/prd-permission-matrix.ts dùng chung với unit test)
```

Mỗi module: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`.

## Quy ước API

- Tiền tố (PRD chương 4): `/api/v1` trên `<tenant>.<APP_BASE_DOMAIN>`, `/platform/api/v1` trên domain gốc, `/health/*` ngoài tiền tố.
- JSON **snake_case** (PRD): body, query, response, tên field trong lỗi. Chuyển đổi ở tầng chung
  (`SnakeCaseRequestPipe` → camelCase cho DTO, `SnakeCaseResponseInterceptor` → snake_case); code TS/Prisma giữ camelCase.
  Key camelCase từ client bị từ chối (422, code `snakeCase`). Swagger cũng hiển thị snake_case.
- Pháp nhân đang chọn: header `X-Company-Id` — phải tồn tại, `ACTIVE`, và user có membership ở đó.
- Lỗi luôn có dạng:
  ```json
  {
    "status_code": 422,
    "code": "VALIDATION_FAILED",
    "message": "...",
    "fields": [{ "field": "siret", "code": "isSiret", "message": "..." }],
    "request_id": "..."
  }
  ```
  Không bao giờ trả stack, SQL hay lỗi Prisma. Danh sách mã: `src/common/errors/error-codes.ts`
  (VD `TENANT_SUSPENDED`, `ACCOUNT_LOCKED` 423, `PLAN_LIMIT_REACHED` 402, `LAST_ADMIN` 409, `OUT_OF_SCOPE` 403).
- Input sai → 422 theo từng field; field lạ bị từ chối.

## Multi-tenant

- Tenant xác định **chỉ** từ subdomain; JWT mang `tid` phải trùng (sai → 401 `WRONG_TENANT`).
- Mỗi tenant: 1 database + 1 role Postgres riêng; role không CONNECT được DB khác hay DB trung tâm (test trong `isolation.e2e-spec.ts`).
  Mật khẩu DB mã hóa AES-256-GCM trong control DB.
- Tenant chỉ lưu **cụm logic** `db_cluster` (hiện chỉ có `default`), không lưu host/port. Địa chỉ lấy lúc chạy từ `TENANT_DB_HOST` / `TENANT_DB_PORT`
  của tiến trình đang chạy (`localhost` ngoài container, `postgres` trong docker compose), nên cùng dữ liệu chạy được cả trong lẫn ngoài container.
  `db_cluster` không xác định → báo lỗi (API trả 500 chung, log ghi rõ), không tự rơi về `default`.
  **Lệch PRD chương 5** (`TENANT_DB` có `host`) theo quyết định của người dùng: host là cấu hình hạ tầng, không phải dữ liệu của tenant.
- Vòng đời (F01 BR-03): `PROVISIONING → ACTIVE ⇄ SUSPENDED → DELETED`, `PROVISIONING → FAILED → PROVISIONING` (retry); sai → 409.
  Muốn xóa một tenant đang ACTIVE phải tạm khóa (SUSPENDED) trước.
  `SUSPENDED` → mọi request 403 `TENANT_SUSPENDED`. Provisioning lỗi → dọn DB/role, trạng thái `FAILED` + `failure_reason`.
- Giới hạn gói (users, pháp nhân) kiểm tra ở backend → 402 `PLAN_LIMIT_REACHED`.

## RBAC (Casbin)

`src/modules/rbac/casbin/model.conf` — RBAC theo domain (domain = pháp nhân) + phạm vi dữ liệu `OWN < COMPANY < TENANT`.

| Khái niệm         | Bảng                                      | Dòng Casbin                                          |
| ----------------- | ----------------------------------------- | ---------------------------------------------------- |
| Quyền của vai trò | `role_permissions` (role, perm, scope)    | `p, role:<id>, customer, read, OWN`                  |
| Gán vai trò       | `memberships` (user, company\|null, role) | `g, user:<id>, role:<id>, company:<id>` (null → `*`) |

- Adapter **chỉ đọc**: bảng DB là nguồn sự thật. Sửa qua API rồi `EnforcerService.policyChanged()` → NOTIFY → mọi instance reload ngay.
- Membership gắn **một** pháp nhân không bao giờ đạt scope `TENANT`, dù vai trò cấp TENANT (chống leo thang quyền).
- Không wildcard. Vai trò hệ thống theo ma trận PRD §1.8, không sửa được; test `permission-catalog.spec.ts` khóa từng ô vai trò × quyền.
- Mặc định từ chối: route phải có `@RequirePermission(resource, action)`, `@AuthOnly()` hoặc `@Public()`.
- Ngoài phạm vi OWN → 403 `OUT_OF_SCOPE` (F04 AC-03); user bị vô hiệu hóa → token bị thu hồi ngay (token version), request kế tiếp 401.

```ts
@Get()
@RequirePermission('customer', 'read')
list(@Access() access: AccessContext) { ... }   // access = { userId, companyId, scope }
```

## Logging, bảo mật HTTP, vận hành

- Log JSON có cấu trúc (pino), `LOG_PRETTY=true` khi dev. Mỗi request có `X-Request-Id` (nhận từ gateway nếu hợp lệ, không thì tự sinh, luôn trả lại).
  Log kèm `tenant`, `tenantId`, `userId`, `companyId`. Header auth/cookie không bao giờ được ghi; các key nhạy cảm (`password`, `mfaSecret`, `dbPasswordEnc`, `connectionString`…) bị redact.
- helmet, CORS cho `*.APP_BASE_DOMAIN` + `CORS_ORIGINS`, rate limit `THROTTLE_DEFAULT_LIMIT`/phút/IP và `THROTTLE_LOGIN_LIMIT`/phút/IP cho login; lockout 5 lần sai / 15 phút → 423 (tenant user và Super Admin).
- Health: `/health/live` (process), `/health/ready` (control DB). Swagger `/docs` chỉ bật ngoài production.
- Graceful shutdown: SIGTERM → đóng HTTP server, pool tenant, listener.
- Production từ chối khởi động nếu `JWT_SECRET`/`DB_CREDENTIALS_KEY` còn giá trị mẫu hoặc `LOG_PRETTY=true`.
- `TENANT_DB_NAME_PREFIX` (mặc định `tenant_`): nhiều môi trường dùng chung một cụm PostgreSQL mà không trùng tên DB.

## Docker

```bash
docker compose --profile app up -d --build   # postgres → job migrate (control + seed + tenants) → app (non-root, healthcheck)
```

## Chưa làm (đợt sau)

| Hạng mục                                                                                                                                  | Ghi chú                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| F02: refresh token (15 phút / 7 ngày, cookie HttpOnly), đăng xuất, quản lý phiên, quên mật khẩu, 2FA TOTP bắt buộc theo vai trò, SSO      | Hiện chỉ có access token; `JWT_EXPIRES_IN=15m`, thu hồi bằng `token_version`       |
| F04/F01: mời user qua email (INVITED, hết hạn 7 ngày), email mời Admin khi tạo tenant                                                     | Hiện tạo user/admin với mật khẩu trong request                                     |
| F01 BR-05: phiên hỗ trợ Super Admin (Admin tenant cấp, ≤ 24 h, audit hai phía)                                                            |                                                                                    |
| F01: provisioning bất đồng bộ (202 + job id, BullMQ), đổi gói, xuất dữ liệu, job xóa tenant sau 30 ngày, API chạy migration toàn nền tảng | Hiện provisioning đồng bộ trong request; migration qua `npm run db:tenants:deploy` |
| F16: ghi audit log mọi thao tác (interceptor) + platform audit log                                                                        | Bảng `audit_logs` đã chỉ-INSERT (trigger)                                          |
| F03: tra cứu SIRET, cấu hình tenant (`tenant_settings`), logo, đổi định dạng số chứng từ                                                  | Bảng `number_sequences.format` đã sẵn                                              |
| F06: phát hiện trùng, import CSV, ghi chú/hoạt động, chuyển khách hàng hàng loạt (`/customers/reassign`)                                  |                                                                                    |
| F07–F12: sản phẩm, báo giá, hóa đơn, avoir, thanh toán, email/PDF                                                                         | Schema đã có (snapshot JSON, `lock_version`, đơn giá numeric(14,4))                |
| Nhiều cụm DB: map tên cụm → địa chỉ (`TENANT_DB_CLUSTERS`) khi chia tenant sang nhiều cụm (NFR Scalability)                               | Hiện chỉ có cụm `default`                                                          |
| Hạ tầng: PgBouncer trước Postgres, throttler storage Redis khi chạy nhiều instance, secrets manager cho khóa DB, Sentry/metrics           |                                                                                    |
