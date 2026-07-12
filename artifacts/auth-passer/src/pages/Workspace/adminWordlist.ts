// Common admin/backoffice endpoint paths. Used to seed the Scan tab when the
// user wants to discover an admin API surface as an alternative route in
// when the normal client-facing endpoint is blocked, rate-limited, or
// otherwise doesn't behave as needed. Not exhaustive — the path list in the
// Scan tab is fully editable.
export const ADMIN_PATH_WORDLIST: string[] = [
  // Generic admin roots
  "admin",
  "administrator",
  "admin-api",
  "admin_api",
  "adminapi",
  "backoffice",
  "back-office",
  "internal",
  "internal-api",
  "manage",
  "management",
  "staff",
  "ops",
  "console",
  "cp",
  "control-panel",
  "controlpanel",
  "dashboard",
  "moderator",
  "mod",
  "root",
  "superuser",
  "super-admin",
  "superadmin",

  // API-prefixed variants
  "api/admin",
  "api/administrator",
  "api/internal",
  "api/manage",
  "api/management",
  "api/staff",
  "api/ops",
  "api/backoffice",
  "api/moderator",
  "api/v1/admin",
  "api/v2/admin",
  "api/v1/internal",
  "api/v1/manage",

  // Nested admin routes
  "admin/login",
  "admin/dashboard",
  "admin/users",
  "admin/user",
  "admin/config",
  "admin/settings",
  "admin/api",
  "admin/panel",
  "admin/console",
  "admin/reports",
  "admin/orders",
  "admin/system",
  "admin/health",
  "admin/status",
  "admin/tools",
  "admin/debug",

  // Framework/CMS defaults
  "wp-admin",
  "wp-json/wp/v2/users",
  "administrator/index.php",
  "django-admin",
  "_admin",
  "sys-admin",
  "sysadmin",

  // Service-management style
  "service-api/admin",
  "service-api/internal",
  "games-frame/admin",
  "games-frame/service-api/admin",
];
