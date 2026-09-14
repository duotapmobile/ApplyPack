export const TOOL_CLUSTER_VERSION = "tool-clusters-v1";

export type ToolTaskTree =
  | { kind: "ALL_OF" | "ANY_OF"; children: ToolTaskTree[] }
  | { kind: "TASK"; taskId: string };

export type GovernedToolCluster = {
  clusterId: "SPREADSHEET" | "CRM" | "REPORTING_BI" | "SQL" | "SYSTEM_ADMINISTRATION";
  aliases: readonly string[];
  tasks: ToolTaskTree;
  version: typeof TOOL_CLUSTER_VERSION;
};

export const governedToolClusters: readonly GovernedToolCluster[] = [
  { clusterId: "SPREADSHEET", aliases: ["excel", "google sheets", "spreadsheet"], tasks: { kind: "ALL_OF", children: [{ kind: "TASK", taskId: "spreadsheet.filter-sort" }, { kind: "ANY_OF", children: [{ kind: "TASK", taskId: "spreadsheet.formulas" }, { kind: "TASK", taskId: "spreadsheet.pivot-tables" }] }] }, version: TOOL_CLUSTER_VERSION },
  { clusterId: "CRM", aliases: ["crm", "salesforce", "hubspot"], tasks: { kind: "ALL_OF", children: [{ kind: "TASK", taskId: "crm.update-records" }, { kind: "TASK", taskId: "crm.manage-pipeline" }] }, version: TOOL_CLUSTER_VERSION },
  { clusterId: "REPORTING_BI", aliases: ["reporting", "business intelligence", "tableau", "power bi"], tasks: { kind: "ANY_OF", children: [{ kind: "TASK", taskId: "reporting.build-dashboard" }, { kind: "TASK", taskId: "reporting.explain-metrics" }] }, version: TOOL_CLUSTER_VERSION },
  { clusterId: "SQL", aliases: ["sql"], tasks: { kind: "ALL_OF", children: [{ kind: "TASK", taskId: "sql.write-query" }, { kind: "TASK", taskId: "sql.validate-result" }] }, version: TOOL_CLUSTER_VERSION },
  { clusterId: "SYSTEM_ADMINISTRATION", aliases: ["system administration", "administrator"], tasks: { kind: "ALL_OF", children: [{ kind: "TASK", taskId: "admin.manage-access" }, { kind: "TASK", taskId: "admin.configure-system" }] }, version: TOOL_CLUSTER_VERSION },
] as const;

export function resolveToolTaskTree(input: { namedTasks: readonly string[]; genericClusterId?: GovernedToolCluster["clusterId"] | null }): ToolTaskTree {
  const named = [...new Set(input.namedTasks.map((task) => task.trim()).filter(Boolean))].sort();
  if (named.length) return { kind: "ALL_OF", children: named.map((taskId) => ({ kind: "TASK", taskId })) };
  const cluster = governedToolClusters.find((candidate) => candidate.clusterId === input.genericClusterId);
  if (!cluster) throw new Error("tool_task_definition_missing");
  return cluster.tasks;
}

export function equivalentToolAllowed(input: { exact: boolean; mappingVersion?: string; rationale?: string; mappedTasks?: readonly string[] }) {
  if (input.exact) return true;
  return Boolean(input.mappingVersion && input.rationale?.trim() && input.mappedTasks?.length);
}

export function taskTreePasses(tree: ToolTaskTree, confirmedTaskIds: ReadonlySet<string>): boolean {
  if (tree.kind === "TASK") return confirmedTaskIds.has(tree.taskId);
  if (!tree.children.length) throw new Error("empty_tool_task_tree");
  return tree.kind === "ALL_OF" ? tree.children.every((child) => taskTreePasses(child, confirmedTaskIds)) : tree.children.some((child) => taskTreePasses(child, confirmedTaskIds));
}
