export type PermissionLevel = 'none' | 'read' | 'write' | 'execute' | 'admin';

export interface Permission {
  id: string;
  name: string;
  description: string;
  level: PermissionLevel;
  category: 'system' | 'file' | 'network' | 'memory' | 'security';
}

export interface PermissionGrant {
  permissionId: string;
  granted: boolean;
  expiresAt?: number;
  grantedBy?: string;
  reason?: string;
}

export interface PermissionCheckResult {
  allowed: boolean;
  permission: Permission;
  grant?: PermissionGrant;
  reason?: string;
}

const PERMISSIONS: Record<string, Permission> = {
  'file.read': {
    id: 'file.read',
    name: '文件读取',
    description: '读取本地文件系统',
    level: 'read',
    category: 'file',
  },
  'file.write': {
    id: 'file.write',
    name: '文件写入',
    description: '写入本地文件系统',
    level: 'write',
    category: 'file',
  },
  'file.delete': {
    id: 'file.delete',
    name: '文件删除',
    description: '删除本地文件',
    level: 'execute',
    category: 'file',
  },
  'shell.execute': {
    id: 'shell.execute',
    name: '命令执行',
    description: '执行系统命令',
    level: 'execute',
    category: 'system',
  },
  'process.manage': {
    id: 'process.manage',
    name: '进程管理',
    description: '启动和终止进程',
    level: 'execute',
    category: 'system',
  },
  'network.request': {
    id: 'network.request',
    name: '网络请求',
    description: '发起网络请求',
    level: 'write',
    category: 'network',
  },
  'network.socket': {
    id: 'network.socket',
    name: '网络套接字',
    description: '创建和管理网络套接字',
    level: 'execute',
    category: 'network',
  },
  'memory.read': {
    id: 'memory.read',
    name: '记忆读取',
    description: '读取记忆数据',
    level: 'read',
    category: 'memory',
  },
  'memory.write': {
    id: 'memory.write',
    name: '记忆写入',
    description: '写入记忆数据',
    level: 'write',
    category: 'memory',
  },
  'security.admin': {
    id: 'security.admin',
    name: '管理员权限',
    description: '执行需要管理员权限的操作',
    level: 'admin',
    category: 'security',
  },
};

export class PermissionManager {
  private grants: Map<string, PermissionGrant[]> = new Map();

  checkPermission(permissionId: string): PermissionCheckResult {
    const permission = PERMISSIONS[permissionId];
    
    if (!permission) {
      return {
        allowed: false,
        permission: {
          id: permissionId,
          name: '未知权限',
          description: '未知权限',
          level: 'none',
          category: 'system',
        },
        reason: '未知权限',
      };
    }

    const permissionGrants = this.grants.get(permissionId) || [];
    const activeGrant = permissionGrants.find(g => g.granted && (!g.expiresAt || Date.now() < g.expiresAt));

    if (activeGrant) {
      return {
        allowed: true,
        permission,
        grant: activeGrant,
      };
    }

    return {
      allowed: false,
      permission,
      reason: '权限未授予',
    };
  }

  grantPermission(permissionId: string, options?: { expiresAt?: number; reason?: string }): boolean {
    if (!PERMISSIONS[permissionId]) {
      return false;
    }

    const grants = this.grants.get(permissionId) || [];
    grants.push({
      permissionId,
      granted: true,
      expiresAt: options?.expiresAt,
      reason: options?.reason,
    });
    this.grants.set(permissionId, grants);

    return true;
  }

  revokePermission(permissionId: string): boolean {
    const grants = this.grants.get(permissionId);
    
    if (!grants) return false;

    for (const grant of grants) {
      grant.granted = false;
    }

    return true;
  }

  hasPermission(permissionId: string): boolean {
    return this.checkPermission(permissionId).allowed;
  }

  getPermission(permissionId: string): Permission | undefined {
    return PERMISSIONS[permissionId];
  }

  listPermissions(): Permission[] {
    return Object.values(PERMISSIONS);
  }

  listPermissionsByCategory(category: Permission['category']): Permission[] {
    return Object.values(PERMISSIONS).filter(p => p.category === category);
  }

  getActiveGrants(): Record<string, PermissionGrant> {
    const result: Record<string, PermissionGrant> = {};

    for (const [permissionId, grants] of this.grants) {
      const activeGrant = grants.find(g => g.granted && (!g.expiresAt || Date.now() < g.expiresAt));
      if (activeGrant) {
        result[permissionId] = activeGrant;
      }
    }

    return result;
  }
}

export default PermissionManager;