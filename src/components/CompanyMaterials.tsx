import { useState } from "react";
import { Building2 } from "lucide-react";
import FolderTree from "./company-materials/FolderTree";
import MaterialList from "./company-materials/MaterialList";

export default function CompanyMaterials() {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Building2 className="w-6 h-6 text-accent" />
          公司材料库
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          按目录分类管理公司资质证书、营业执照等材料
        </p>
      </div>

      <div className="flex border rounded-lg overflow-hidden bg-background" style={{ height: "calc(100vh - 200px)" }}>
        {/* Left: folder tree */}
        <div className="w-64 border-r shrink-0 overflow-hidden">
          <FolderTree
            selectedFolderId={selectedFolderId}
            onSelectFolder={setSelectedFolderId}
            refreshKey={refreshKey}
          />
        </div>

        {/* Right: material list */}
        <div className="flex-1 overflow-hidden">
          <MaterialList
            folderId={selectedFolderId}
            onMaterialChange={() => setRefreshKey((k) => k + 1)}
          />
        </div>
      </div>
    </div>
  );
}
