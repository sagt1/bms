export type PermissionProfile = Record<string, unknown> & {
  role?: string;
  is_active?: boolean | null;
};

export type PermissionModule = {
  key: string;
  permission?: string;
  navigation?: string;
};

export type AttendanceCapabilities = {
  canView: boolean;
  canRecordAttendance: boolean;
  canRequestCorrection: boolean;
  canReviewCorrections: boolean;
  isAdmin: boolean;
};

const ADMIN_HIDDEN_NAVIGATION_KEYS = new Set(['documents', 'surveys']);

function permissionColumn(permission: string, access: 'view' | 'edit'): string {
  if (permission === 'invoice') return `${access === 'view' ? 'can_view' : 'can_edit'}_invoices`;
  if (permission === 'survey') return `${access === 'view' ? 'can_view' : 'can_edit'}_surveys`;
  return `${access === 'view' ? 'can_view' : 'can_edit'}_${permission}`;
}

export function canViewModule(
  profile: PermissionProfile | null,
  module: PermissionModule,
): boolean {
  if (!profile || profile.is_active !== true) return false;
  if (module.key === 'dashboard') return profile.role === 'admin' || profile.nav_dashboard === true;
  if (profile.role === 'admin') return !ADMIN_HIDDEN_NAVIGATION_KEYS.has(module.key);
  if (module.key === 'team' || module.key === 'payroll') return false;
  if (module.navigation && profile[module.navigation] !== true) return false;

  const permission = module.permission ?? module.key;
  return profile[permissionColumn(permission, 'view')] === true;
}

export function canEditModule(
  profile: PermissionProfile | null,
  module: PermissionModule,
): boolean {
  if (!profile || profile.is_active !== true) return false;
  if (profile.role === 'admin') return !ADMIN_HIDDEN_NAVIGATION_KEYS.has(module.key) && module.key !== 'dashboard';
  if (module.key === 'team' || module.key === 'payroll' || module.key === 'payslip') return false;
  if (module.navigation && profile[module.navigation] !== true) return false;
  if (!canViewModule(profile, module)) return false;

  const permission = module.permission ?? module.key;
  return profile[permissionColumn(permission, 'edit')] === true;
}

export function getAttendanceCapabilities(profile: PermissionProfile | null): AttendanceCapabilities {
  const module = { key: 'attendance', permission: 'attendance', navigation: 'nav_attendance' };
  const active = profile?.is_active === true;
  const isAdmin = active && profile?.role === 'admin';
  const isEmployee = active && profile?.role === 'employee';
  const canView = canViewModule(profile, module);
  const canEdit = canEditModule(profile, module);

  return {
    canView,
    canRecordAttendance: isEmployee && canView && canEdit,
    canRequestCorrection: isEmployee && canView && canEdit,
    canReviewCorrections: isAdmin && canView,
    isAdmin,
  };
}
