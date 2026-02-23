import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Bot } from "lucide-react";
import UserManagement from "./UserManagement";
import ModelManagement from "./ModelManagement";

const BackendManagement = () => {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">后台管理</h2>
        <p className="text-sm text-muted-foreground mt-1">系统用户与AI模型配置管理</p>
      </div>

      <Tabs defaultValue="users" className="w-full">
        <TabsList>
          <TabsTrigger value="users" className="gap-1.5">
            <Users className="w-3.5 h-3.5" />
            用户管理
          </TabsTrigger>
          <TabsTrigger value="models" className="gap-1.5">
            <Bot className="w-3.5 h-3.5" />
            模型管理
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users">
          <UserManagement />
        </TabsContent>
        <TabsContent value="models">
          <ModelManagement />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default BackendManagement;
