# COMPTE BE — CRM Báo giá / Hóa đơn (multi-tenant SaaS)

NestJS 11 · Prisma 7 · PostgreSQL 17 (mỗi tenant một database) · Casbin RBAC · nestjs-pino.
Đặc tả: PRD/FS v0.1 (F01–F19). Mã AC/BR trong code và test tham chiếu tài liệu này.

## Chạy lần đầu

```bash
cp .env.example .env          # sinh DB_CREDENTIALS_KEY và JWT_SECRET thật (lệnh trong file)
npm install                   # tự chạy prisma generate cho 2 schema + cài husky
docker compose up -d          # PostgreSQL 17
npm run db:control:deploy     # migrate DB trung tâm
npm run db:control:seed       # gói dịch vụ + Super Admin (PLATFORM_ADMIN_*)
npm run start:dev             # http://localhost:3000, Swagger: http://localhost:3000/docs
```

Tạo tenant và gọi API tenant:

```bash
# Super Admin (domain gốc)
curl -X POST localhost:3000/platform/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@platform.local","password":"ChangeMe-Platform-2026"}'
curl -X POST localhost:3000/platform/api/v1/tenants -H "Authorization: Bearer <token>" -H 'Content-Type: application/json' \
  -d '{"name":"Groupe DFM","subdomain":"dfm","planCode":"business","companyLegalName":"DFM-EUROPE",
       "adminEmail":"frederic@dfm.fr","adminFullName":"Frederic","adminPassword":"Frederic-2026-Secure"}'

# Tenant (subdomain)
curl -X POST http://dfm.localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"frederic@dfm.fr","password":"Frederic-2026-Secure"}'
curl http://dfm.localhost:3000/api/v1/customers -H "Authorization: Bearer <token>" -H "X-Company-Id: <company id>"
```

## Scripts

| Script                                       | Việc                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `start:dev` / `build` / `start:prod`         | Chạy dev (watch) / build / chạy bản build                                 |
| `lint`, `lint:fix`, `format`, `format:check` | ESLint (flat config, type-aware) + Prettier                               |
| `typecheck`                                  | `tsc --noEmit` cho src, test, scripts                                     |
| `test`                                       | Unit test (không cần DB)                                                  |
| `test:e2e`                                   | E2E Jest + supertest trên PostgreSQL thật (tạo/xóa tenant `e2e-*`)        |
| `db:control:migrate` / `db:control:deploy`   | Tạo migration / áp migration DB trung tâm                                 |
| `db:control:seed`                            | Seed gói dịch vụ + Super Admin                                            |
| `db:tenant:migrate -- --name x`              | Tạo migration schema tenant (trên DB dev `TENANT_DATABASE_URL`)           |
| `db:tenants:deploy [-- --tenant=dfm]`        | Áp migration cho mọi tenant, đồng bộ danh mục quyền, ghi `schema_version` |

Pre-commit (husky + lint-staged): ESLint `--fix` + Prettier trên file đã stage.

## Cấu trúc thư mục

```
prisma/
  control/  schema.prisma (generator+datasource) · models/*.prisma · enums/*.prisma · migrations/
  tenant/   schema.prisma · models/*.prisma · enums/*.prisma · migrations/
            → MỖI MODEL / ENUM MỘT FILE. SQL Prisma không biểu diễn được (CHECK, trigger,
              NULLS NOT DISTINCT) viết tay ở cuối migration, có comment.
src/
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
test/            e2e: platform, isolation, rbac, customers, http, throttle (+ support/, setup/)
```

Mỗi module: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/`.

## Quy ước API

- Tiền tố (PRD chương 4): `/api/v1` trên `<tenant>.<APP_BASE_DOMAIN>`, `/platform/api/v1` trên domain gốc, `/health/*` ngoài tiền tố.
- Pháp nhân đang chọn: header `X-Company-Id` — phải tồn tại, `ACTIVE`, và user có membership ở đó.
- Lỗi luôn có dạng:
  ```json
  {
    "statusCode": 422,
    "code": "VALIDATION_FAILED",
    "message": "...",
    "fields": [{ "field": "siret", "code": "isSiret", "message": "..." }],
    "requestId": "..."
  }
  ```
  Không bao giờ trả stack, SQL hay lỗi Prisma. Danh sách mã: `src/common/errors/error-codes.ts`
  (VD `TENANT_SUSPENDED`, `ACCOUNT_LOCKED` 423, `PLAN_LIMIT_REACHED` 402, `LAST_ADMIN` 409, `OUT_OF_SCOPE` 403).
- Input sai → 422 theo từng field; field lạ bị từ chối.

## Multi-tenant

- Tenant xác định **chỉ** từ subdomain; JWT mang `tid` phải trùng (sai → 401 `WRONG_TENANT`).
- Mỗi tenant: 1 database + 1 role Postgres riêng; role không CONNECT được DB khác hay DB trung tâm (test trong `isolation.e2e-spec.ts`).
  Mật khẩu DB mã hóa AES-256-GCM trong control DB.
- Vòng đời (F01 BR-03): `PROVISIONING → ACTIVE ⇄ SUSPENDED → DELETED`, `PROVISIONING → FAILED → PROVISIONING` (retry); sai → 409.
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
- Production từ chối khởi động nếu `JWT_SECRET`/`DB_CREDENTIALS_KEY` còn giá trị mẫu, `LOG_PRETTY=true` hoặc còn `PLATFORM_ADMIN_PASSWORD`.

## Docker & CI

```bash
docker compose --profile app up -d --build   # postgres → job migrate (control) → app (non-root, healthcheck)
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
| Hạ tầng: PgBouncer trước Postgres, throttler storage Redis khi chạy nhiều instance, secrets manager cho khóa DB, Sentry/metrics           |                                                                                    |
| Quy ước JSON: PRD dùng snake_case (`full_name`, `plan_id`), API hiện dùng camelCase                                                       | Cần chốt trước khi làm frontend                                                    |
