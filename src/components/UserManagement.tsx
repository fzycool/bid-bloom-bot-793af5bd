import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  CheckCircle,
  XCircle,
  Loader2,
  ShieldCheck,
  Clock,
} from "lucide-react";

interface UserProfile {
  id: string;
  user_id: string;
  full_name: string | null;
  company: string | null;
  department: string | null;
  is_approved: boolean;
  created_at: string;
  email?: string;
}

const UserManagement = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (err: any) {
      toast({ title: "加载失败", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleApproval = async (profileId: string, approve: boolean) => {
    setActionLoading(profileId);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ is_approved: approve })
        .eq("id", profileId);

      if (error) throw error;
      toast({ title: approve ? "已批准" : "已拒绝" });
      fetchUsers();
    } catch (err: any) {
      toast({ title: "操作失败", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const pendingUsers = users.filter((u) => !u.is_approved && u.user_id !== user?.id);
  const approvedUsers = users.filter((u) => u.is_approved);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">用户管理</h2>
        <p className="text-sm text-muted-foreground mt-1">审批新注册用户，管理系统成员</p>
      </div>

      {/* Pending approval */}
      {pendingUsers.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Clock className="w-4 h-4 text-yellow-500" />
            待审批 ({pendingUsers.length})
          </h3>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">姓名</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">公司</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">注册时间</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">操作</th>
                </tr>
              </thead>
              <tbody>
                {pendingUsers.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                      {u.full_name || "未设置"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                      {u.company || "-"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                      {new Date(u.created_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApproval(u.id, true)}
                          disabled={actionLoading === u.id}
                        >
                          {actionLoading === u.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <CheckCircle className="w-3 h-3 mr-1" />
                          )}
                          批准
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleApproval(u.id, false)}
                          disabled={actionLoading === u.id}
                        >
                          <XCircle className="w-3 h-3 mr-1" />
                          拒绝
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Approved users */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-green-500" />
          已审批用户 ({approvedUsers.length})
        </h3>
        {approvedUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">暂无已审批用户</p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">姓名</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden sm:table-cell">公司</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">部门</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">注册时间</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">状态</th>
                </tr>
              </thead>
              <tbody>
                {approvedUsers.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                      {u.full_name || "未设置"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                      {u.company || "-"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                      {u.department || "-"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                      {new Date(u.created_at).toLocaleDateString("zh-CN")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge variant="secondary" className="text-xs">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        已批准
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pendingUsers.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">暂无待审批用户</p>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
