import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import {
  Shield,
  FileSearch,
  Users,
  BookOpen,
  CheckCircle,
  Eye,
  EyeOff,
} from "lucide-react";

const Index = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    company: "",
  });

  const features = [
    { icon: BookOpen, label: "私有化知识库" },
    { icon: FileSearch, label: "招标文件解析" },
    { icon: Users, label: "简历智能工场" },
    { icon: Shield, label: "全息逻辑审查" },
    { icon: CheckCircle, label: "合规避险保障" },
  ];

  return (
    <div className="min-h-screen flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-[55%] bg-hero relative overflow-hidden flex-col justify-between p-12">
        {/* Decorative elements */}
        <div className="absolute inset-0 bg-glow opacity-30" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute -top-16 -right-16 w-72 h-72 rounded-full bg-accent/5 blur-2xl" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-accent flex items-center justify-center">
              <Shield className="w-6 h-6 text-accent-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-primary-foreground tracking-tight">
              智标工场
            </h1>
          </div>
          <p className="text-primary-foreground/60 text-sm">
            招投标全流程智能协作平台
          </p>
        </div>

        <div className="relative z-10 space-y-8">
          <div>
            <h2 className="text-3xl xl:text-4xl font-bold text-primary-foreground leading-tight mb-4">
              让每一次投标
              <br />
              <span className="text-gradient-accent">精准、合规、高效</span>
            </h2>
            <p className="text-primary-foreground/70 text-base leading-relaxed max-w-md">
              从读标、写人到组卷审查，AI驱动的全流程智能协作，
              杜绝废标风险，提升中标概率。
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {features.map((f) => (
              <div
                key={f.label}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary-foreground/10 backdrop-blur-sm border border-primary-foreground/10"
              >
                <f.icon className="w-4 h-4 text-accent" />
                <span className="text-sm text-primary-foreground/90">
                  {f.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10">
          <p className="text-primary-foreground/40 text-xs">
            © 2024 智标工场 · 企业内部系统 · 数据安全保障
          </p>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="w-full lg:w-[45%] flex items-center justify-center p-6 sm:p-12 bg-background">
        <div className="w-full max-w-md">
          {/* Mobile branding */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-9 h-9 rounded-lg bg-accent flex items-center justify-center">
              <Shield className="w-5 h-5 text-accent-foreground" />
            </div>
            <h1 className="text-xl font-bold text-foreground">智标工场</h1>
          </div>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-8">
              <TabsTrigger value="login" className="text-sm font-medium">
                登录
              </TabsTrigger>
              <TabsTrigger value="register" className="text-sm font-medium">
                注册
              </TabsTrigger>
            </TabsList>

            {/* Login Tab */}
            <TabsContent value="login">
              <Card className="border-0 shadow-none bg-transparent">
                <CardContent className="p-0 space-y-6">
                  <div>
                    <h3 className="text-2xl font-bold text-foreground mb-1">
                      欢迎回来
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      登录您的企业账号以继续使用
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">邮箱地址</Label>
                      <Input
                        id="login-email"
                        type="email"
                        placeholder="name@company.com"
                        value={loginForm.email}
                        onChange={(e) =>
                          setLoginForm({ ...loginForm, email: e.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="login-password">密码</Label>
                        <button className="text-xs text-accent hover:underline">
                          忘记密码？
                        </button>
                      </div>
                      <div className="relative">
                        <Input
                          id="login-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="请输入密码"
                          value={loginForm.password}
                          onChange={(e) =>
                            setLoginForm({
                              ...loginForm,
                              password: e.target.value,
                            })
                          }
                        />
                        <button
                          type="button"
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  <Button className="w-full h-11 text-sm font-semibold">
                    登 录
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Register Tab */}
            <TabsContent value="register">
              <Card className="border-0 shadow-none bg-transparent">
                <CardContent className="p-0 space-y-6">
                  <div>
                    <h3 className="text-2xl font-bold text-foreground mb-1">
                      创建账号
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      请联系管理员获取注册权限
                    </p>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="reg-name">姓名</Label>
                        <Input
                          id="reg-name"
                          placeholder="您的姓名"
                          value={registerForm.name}
                          onChange={(e) =>
                            setRegisterForm({
                              ...registerForm,
                              name: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="reg-company">所属企业</Label>
                        <Input
                          id="reg-company"
                          placeholder="企业名称"
                          value={registerForm.company}
                          onChange={(e) =>
                            setRegisterForm({
                              ...registerForm,
                              company: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-email">企业邮箱</Label>
                      <Input
                        id="reg-email"
                        type="email"
                        placeholder="name@company.com"
                        value={registerForm.email}
                        onChange={(e) =>
                          setRegisterForm({
                            ...registerForm,
                            email: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-password">设置密码</Label>
                      <Input
                        id="reg-password"
                        type="password"
                        placeholder="至少8位，含字母和数字"
                        value={registerForm.password}
                        onChange={(e) =>
                          setRegisterForm({
                            ...registerForm,
                            password: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="reg-confirm">确认密码</Label>
                      <Input
                        id="reg-confirm"
                        type="password"
                        placeholder="再次输入密码"
                        value={registerForm.confirmPassword}
                        onChange={(e) =>
                          setRegisterForm({
                            ...registerForm,
                            confirmPassword: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>

                  <Button className="w-full h-11 text-sm font-semibold">
                    注 册
                  </Button>

                  <p className="text-xs text-muted-foreground text-center">
                    注册即表示您同意
                    <button className="text-accent hover:underline mx-1">
                      服务协议
                    </button>
                    和
                    <button className="text-accent hover:underline mx-1">
                      隐私政策
                    </button>
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default Index;
