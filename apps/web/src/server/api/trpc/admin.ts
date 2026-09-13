import { AdminDashboardSchema, getAdminDashboard } from "../../admin-dashboard.js";
import { adminProcedure, router } from "./_config.js";

export const adminRouter = router({
  dashboard: adminProcedure.output(AdminDashboardSchema).query(() => getAdminDashboard()),
});
