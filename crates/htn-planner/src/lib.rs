//! OpenOxygen Next - HTN (Hierarchical Task Network) Planner
//! 
//! 层次化任务网络规划器
//! 支持任务分解、前置条件检查、效果应用、冲突消解

use std::collections::{HashMap, HashSet, VecDeque};
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

pub mod domain;
pub mod decomposer;
pub mod resolver;

/// HTN 规划器
#[derive(Debug, Clone)]
pub struct HtnPlanner {
    /// 领域定义
    domain: domain::Domain,
    /// 当前世界状态
    world_state: WorldState,
    /// 规划配置
    config: PlannerConfig,
}

/// 规划配置
#[derive(Debug, Clone)]
pub struct PlannerConfig {
    /// 最大搜索深度
    pub max_depth: usize,
    /// 最大迭代次数
    pub max_iterations: usize,
    /// 是否允许部分规划
    pub allow_partial: bool,
    /// 是否启用冲突检测
    pub enable_conflict_detection: bool,
    /// 超时时间 (ms)
    pub timeout_ms: u64,
    /// 回溯策略
    pub backtrack_strategy: BacktrackStrategy,
}

impl Default for PlannerConfig {
    fn default() -> Self {
        Self {
            max_depth: 10,
            max_iterations: 1000,
            allow_partial: false,
            enable_conflict_detection: true,
            timeout_ms: 30000,
            backtrack_strategy: BacktrackStrategy::Chronological,
        }
    }
}

/// 回溯策略
#[derive(Debug, Clone, Copy)]
pub enum BacktrackStrategy {
    /// 时序回溯
    Chronological,
    /// 冲突导向回溯
    ConflictDirected,
    /// 智能回溯
    Intelligent,
}

/// 世界状态
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorldState {
    /// 状态变量
    pub variables: HashMap<String, StateValue>,
    /// 时间戳
    pub timestamp: DateTime<Utc>,
    /// 元数据
    pub metadata: HashMap<String, serde_json::Value>,
}

/// 状态值
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum StateValue {
    Bool(bool),
    Int(i64),
    Float(f64),
    String(String),
    List(Vec<StateValue>),
    Map(HashMap<String, StateValue>),
    Null,
}

impl StateValue {
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            StateValue::Bool(b) => Some(*b),
            _ => None,
        }
    }
    
    pub fn as_int(&self) -> Option<i64> {
        match self {
            StateValue::Int(i) => Some(*i),
            _ => None,
        }
    }
    
    pub fn as_string(&self) -> Option<&str> {
        match self {
            StateValue::String(s) => Some(s),
            _ => None,
        }
    }
}

/// HTN 任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub name: String,
    pub description: String,
    /// 任务类型
    pub task_type: TaskType,
    /// 任务参数
    pub parameters: HashMap<String, serde_json::Value>,
    /// 任务元数据
    pub metadata: TaskMetadata,
}

/// 任务类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TaskType {
    /// 原始任务（不可再分解）
    #[serde(rename = "primitive")]
    Primitive(PrimitiveTask),
    /// 复合任务（可分解）
    #[serde(rename = "compound")]
    Compound(CompoundTask),
    /// 目标状态
    #[serde(rename = "goal")]
    Goal(GoalTask),
}

/// 原始任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimitiveTask {
    /// 前置条件
    pub preconditions: Vec<Condition>,
    /// 后置效果
    pub effects: Vec<Effect>,
    /// 执行动作
    pub action: Action,
    /// 执行成本
    pub cost: f64,
    /// 执行时间估计 (ms)
    pub estimated_duration_ms: u64,
    /// 是否可重试
    pub retryable: bool,
    /// 最大重试次数
    pub max_retries: u32,
}

/// 复合任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompoundTask {
    /// 分解方法列表
    pub methods: Vec<Method>,
    /// 默认方法索引
    pub default_method: usize,
}

/// 目标任务
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoalTask {
    /// 目标条件
    pub goal_conditions: Vec<Condition>,
    /// 达成目标的方法
    pub methods: Vec<Method>,
}

/// 任务元数据
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TaskMetadata {
    pub priority: i32,
    pub deadline: Option<DateTime<Utc>>,
    pub tags: Vec<String>,
    pub constraints: Vec<String>,
}

/// 方法（分解方式）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Method {
    pub id: String,
    pub name: String,
    /// 适用条件
    pub preconditions: Vec<Condition>,
    /// 子任务序列
    pub subtasks: Vec<SubTaskSpec>,
    /// 约束条件
    pub constraints: Vec<Constraint>,
    /// 方法成本
    pub cost: f64,
}

/// 子任务规格
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubTaskSpec {
    /// 子任务名称（可包含变量）
    pub task_name: String,
    /// 参数绑定
    pub parameters: HashMap<String, serde_json::Value>,
    /// 顺序约束
    pub order: Option<usize>,
    /// 并行组
    pub parallel_group: Option<String>,
    /// 依赖任务
    pub dependencies: Vec<String>,
}

/// 条件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Condition {
    /// 条件类型
    pub condition_type: ConditionType,
    /// 状态变量路径
    pub variable_path: String,
    /// 期望值
    pub expected_value: StateValue,
    /// 比较操作
    pub operator: ComparisonOperator,
}

/// 条件类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConditionType {
    /// 状态存在
    StateExists,
    /// 状态等于
    StateEquals,
    /// 状态包含
    StateContains,
    /// 自定义谓词
    Custom(String),
}

/// 比较操作
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonOperator {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Contains,
    StartsWith,
    EndsWith,
    Regex(String),
}

/// 效果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Effect {
    /// 效果类型
    pub effect_type: EffectType,
    /// 状态变量路径
    pub variable_path: String,
    /// 新值
    pub new_value: StateValue,
    /// 是否条件效果
    pub condition: Option<Condition>,
}

/// 效果类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectType {
    Add,
    Delete,
    Update,
    Append,
    Remove,
}

/// 约束
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Constraint {
    pub constraint_type: ConstraintType,
    pub params: serde_json::Value,
}

/// 约束类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConstraintType {
    /// 顺序约束
    Order,
    /// 时间约束
    Temporal,
    /// 资源约束
    Resource,
    /// 互斥约束
    Mutex,
    /// 因果约束
    Causal,
}

/// 动作
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub action_type: String,
    pub params: HashMap<String, serde_json::Value>,
}

/// 规划请求
#[derive(Debug, Clone)]
pub struct PlanRequest {
    /// 根任务
    pub root_task: Task,
    /// 初始状态
    pub initial_state: WorldState,
    /// 规划目标
    pub goal_state: Option<WorldState>,
    /// 配置覆盖
    pub config_override: Option<PlannerConfig>,
    /// 上下文信息
    pub context: PlanContext,
}

/// 规划上下文
#[derive(Debug, Clone, Default)]
pub struct PlanContext {
    pub session_id: Option<String>,
    pub task_id: Option<String>,
    pub user_intent: Option<String>,
    pub available_agents: Vec<String>,
    pub available_skills: Vec<String>,
}

/// 规划结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanResult {
    pub plan_id: String,
    pub success: bool,
    /// 任务网络
    pub task_network: TaskNetwork,
    /// 世界状态变化轨迹
    pub state_trace: Vec<StateSnapshot>,
    /// 规划统计
    pub statistics: PlanStatistics,
    /// 元信息
    pub metadata: PlanMetadata,
}

/// 任务网络
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNetwork {
    /// 所有任务
    pub tasks: HashMap<String, TaskNode>,
    /// 根任务 ID
    pub root_id: String,
    /// 边（依赖关系）
    pub edges: Vec<TaskEdge>,
}

/// 任务节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskNode {
    pub id: String,
    pub task: Task,
    /// 父任务 ID
    pub parent_id: Option<String>,
    /// 子任务 IDs
    pub children_ids: Vec<String>,
    /// 深度
    pub depth: usize,
    /// 执行状态
    pub status: TaskStatus,
    /// 规划信息
    pub plan_info: TaskPlanInfo,
}

/// 任务状态（规划中）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Selected,
    Decomposed,
    Planned,
    Failed,
}

/// 任务规划信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TaskPlanInfo {
    /// 选择的方法 ID
    pub selected_method: Option<String>,
    /// 规划时间
    pub plan_time_ms: u64,
    /// 回溯次数
    pub backtracks: u32,
}

/// 任务边（依赖）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskEdge {
    pub from: String,
    pub to: String,
    pub edge_type: EdgeType,
}

/// 边类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeType {
    /// 顺序依赖
    Sequential,
    /// 并行
    Parallel,
    /// 因果依赖
    Causal,
    /// 互斥
    Mutex,
}

/// 状态快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StateSnapshot {
    pub task_id: String,
    pub state: WorldState,
    pub action: Option<String>,
}

/// 规划统计
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PlanStatistics {
    pub total_tasks: usize,
    pub primitive_tasks: usize,
    pub compound_tasks: usize,
    pub methods_applied: usize,
    pub backtracks: usize,
    pub planning_time_ms: u64,
    pub max_depth_reached: usize,
}

/// 规划元数据
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PlanMetadata {
    pub created_at: DateTime<Utc>,
    pub config_used: String,
    pub planner_version: String,
}

/// DAG（有向无环图）执行计划
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DagPlan {
    pub nodes: Vec<DagNode>,
    pub edges: Vec<DagEdge>,
    pub entry_points: Vec<String>,
    pub exit_points: Vec<String>,
}

/// DAG 节点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DagNode {
    pub id: String,
    pub task: Task,
    /// 最早开始时间
    pub earliest_start: u64,
    /// 最晚开始时间
    pub latest_start: u64,
    /// 预计持续时间
    pub duration: u64,
}

/// DAG 边
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DagEdge {
    pub from: String,
    pub to: String,
    /// 边的类型
    pub edge_type: EdgeType,
    /// 延迟时间
    pub delay: u64,
}

impl HtnPlanner {
    /// 创建新的 HTN 规划器
    pub fn new(domain: domain::Domain, initial_state: WorldState) -> Self {
        Self {
            domain,
            world_state: initial_state,
            config: PlannerConfig::default(),
        }
    }

    /// 设置配置
    pub fn with_config(mut self, config: PlannerConfig) -> Self {
        self.config = config;
        self
    }

    /// 执行规划
    pub async fn plan(&self, request: PlanRequest) -> Result<PlanResult, PlannerError> {
        let start_time = std::time::Instant::now();
        let plan_id = Uuid::new_v4().to_string();
        
        let config = request.config_override.unwrap_or_else(|| self.config.clone());
        
        // 初始化任务网络
        let mut network = TaskNetwork {
            tasks: HashMap::new(),
            root_id: request.root_task.id.clone(),
            edges: vec![],
        };
        
        // 创建根节点
        let root_node = TaskNode {
            id: request.root_task.id.clone(),
            task: request.root_task.clone(),
            parent_id: None,
            children_ids: vec![],
            depth: 0,
            status: TaskStatus::Pending,
            plan_info: TaskPlanInfo::default(),
        };
        network.tasks.insert(root_node.id.clone(), root_node);
        
        // 当前世界状态
        let mut current_state = request.initial_state.clone();
        let mut state_trace = vec![StateSnapshot {
            task_id: "initial".to_string(),
            state: current_state.clone(),
            action: None,
        }];
        
        // 待处理任务队列
        let mut pending: VecDeque<String> = VecDeque::from([request.root_task.id.clone()]);
        let mut backtracks = 0usize;
        let mut methods_applied = 0usize;
        let mut max_depth = 0usize;
        let mut iteration = 0usize;
        
        // 主规划循环
        while let Some(task_id) = pending.pop_front() {
            iteration += 1;
            if iteration > config.max_iterations {
                return Err(PlannerError::MaxIterationsReached);
            }
            
            let task_node = network.tasks.get(&task_id).cloned()
                .ok_or_else(|| PlannerError::TaskNotFound(task_id.clone()))?;
            
            max_depth = max_depth.max(task_node.depth);
            if task_node.depth > config.max_depth {
                continue;
            }
            
            // 根据任务类型处理
            match &task_node.task.task_type {
                TaskType::Primitive(primitive) => {
                    // 检查前置条件
                    if self.check_preconditions(&primitive.preconditions, &current_state) {
                        // 应用效果
                        current_state = self.apply_effects(&primitive.effects, current_state);
                        state_trace.push(StateSnapshot {
                            task_id: task_id.clone(),
                            state: current_state.clone(),
                            action: Some(primitive.action.action_type.clone()),
                        });
                        
                        // 更新任务状态
                        if let Some(node) = network.tasks.get_mut(&task_id) {
                            node.status = TaskStatus::Planned;
                        }
                    } else {
                        // 前置条件不满足，需要回溯
                        backtracks += 1;
                        if config.backtrack_strategy == BacktrackStrategy::Chronological {
                            // 简单回溯：跳过此任务
                            if let Some(node) = network.tasks.get_mut(&task_id) {
                                node.status = TaskStatus::Failed;
                            }
                        }
                    }
                }
                
                TaskType::Compound(compound) => {
                    // 找到适用的方法
                    if let Some(method) = self.find_applicable_method(compound, &current_state) {
                        methods_applied += 1;
                        
                        // 分解为子任务
                        let subtask_ids = self.decompose_task(
                            &task_id,
                            &method,
                            &mut network,
                            task_node.depth + 1,
                        )?;
                        
                        // 添加子任务到队列
                        for subtask_id in subtask_ids {
                            pending.push_back(subtask_id);
                        }
                        
                        // 更新任务状态
                        if let Some(node) = network.tasks.get_mut(&task_id) {
                            node.status = TaskStatus::Decomposed;
                            node.plan_info.selected_method = Some(method.id.clone());
                        }
                    } else {
                        // 没有可用方法，回溯
                        backtracks += 1;
                        if let Some(node) = network.tasks.get_mut(&task_id) {
                            node.status = TaskStatus::Failed;
                        }
                    }
                }
                
                TaskType::Goal(goal) => {
                    // 检查目标是否已达成
                    if self.check_preconditions(&goal.goal_conditions, &current_state) {
                        if let Some(node) = network.tasks.get_mut(&task_id) {
                            node.status = TaskStatus::Planned;
                        }
                    } else if let Some(method) = self.find_applicable_method_for_goal(goal, &current_state) {
                        methods_applied += 1;
                        
                        let subtask_ids = self.decompose_task(
                            &task_id,
                            &method,
                            &mut network,
                            task_node.depth + 1,
                        )?;
                        
                        for subtask_id in subtask_ids {
                            pending.push_back(subtask_id);
                        }
                        
                        if let Some(node) = network.tasks.get_mut(&task_id) {
                            node.status = TaskStatus::Decomposed;
                            node.plan_info.selected_method = Some(method.id.clone());
                        }
                    }
                }
            }
        }
        
        // 构建 DAG 执行计划
        let _dag = self.build_dag(&network)?;
        
        let planning_time = start_time.elapsed().as_millis() as u64;
        
        Ok(PlanResult {
            plan_id,
            success: !network.tasks.values().any(|n| n.status == TaskStatus::Failed),
            task_network: network,
            state_trace,
            statistics: PlanStatistics {
                total_tasks: iteration,
                primitive_tasks: 0, // TODO: 统计
                compound_tasks: 0,
                methods_applied,
                backtracks,
                planning_time_ms: planning_time,
                max_depth_reached: max_depth,
            },
            metadata: PlanMetadata {
                created_at: Utc::now(),
                config_used: format!("{:?}", config),
                planner_version: "1.0.0".to_string(),
            },
        })
    }

    /// 检查前置条件
    fn check_preconditions(&self, conditions: &[Condition], state: &WorldState) -> bool {
        for condition in conditions {
            let value = state.variables.get(&condition.variable_path);
            
            let satisfied = match condition.operator {
                ComparisonOperator::Eq => {
                    value == Some(&condition.expected_value)
                }
                ComparisonOperator::Ne => {
                    value != Some(&condition.expected_value)
                }
                ComparisonOperator::Contains => {
                    if let Some(StateValue::List(list)) = value {
                        list.contains(&condition.expected_value)
                    } else {
                        false
                    }
                }
                _ => true, // TODO: 实现其他操作符
            };
            
            if !satisfied {
                return false;
            }
        }
        true
    }

    /// 应用效果
    fn apply_effects(&self, effects: &[Effect], mut state: WorldState) -> WorldState {
        for effect in effects {
            match effect.effect_type {
                EffectType::Add | EffectType::Update => {
                    state.variables.insert(
                        effect.variable_path.clone(),
                        effect.new_value.clone(),
                    );
                }
                EffectType::Delete => {
                    state.variables.remove(&effect.variable_path);
                }
                EffectType::Append => {
                    if let Some(StateValue::List(list)) = state.variables.get_mut(&effect.variable_path) {
                        if let StateValue::List(new_items) = &effect.new_value {
                            list.extend(new_items.clone());
                        }
                    }
                }
                EffectType::Remove => {
                    if let Some(StateValue::List(list)) = state.variables.get_mut(&effect.variable_path) {
                        if let StateValue::List(items_to_remove) = &effect.new_value {
                            list.retain(|item| !items_to_remove.contains(item));
                        }
                    }
                }
            }
        }
        state.timestamp = Utc::now();
        state
    }

    /// 查找适用方法
    fn find_applicable_method(
        &self,
        compound: &CompoundTask,
        state: &WorldState,
    ) -> Option<Method> {
        for method in &compound.methods {
            if self.check_preconditions(&method.preconditions, state) {
                return Some(method.clone());
            }
        }
        compound.methods.get(compound.default_method).cloned()
    }

    /// 查找目标方法
    fn find_applicable_method_for_goal(
        &self,
        goal: &GoalTask,
        state: &WorldState,
    ) -> Option<Method> {
        for method in &goal.methods {
            if self.check_preconditions(&method.preconditions, state) {
                return Some(method.clone());
            }
        }
        goal.methods.first().cloned()
    }

    /// 分解任务
    fn decompose_task(
        &self,
        parent_id: &str,
        method: &Method,
        network: &mut TaskNetwork,
        depth: usize,
    ) -> Result<Vec<String>, PlannerError> {
        let mut subtask_ids = Vec::new();
        
        for spec in &method.subtasks {
            let subtask_id = Uuid::new_v4().to_string();
            
            // 创建子任务
            let subtask = Task {
                id: subtask_id.clone(),
                name: spec.task_name.clone(),
                description: format!("Subtask of method {}", method.name),
                task_type: TaskType::Primitive(PrimitiveTask {
                    preconditions: vec![],
                    effects: vec![],
                    action: Action {
                        action_type: spec.task_name.clone(),
                        params: spec.parameters.clone(),
                    },
                    cost: 1.0,
                    estimated_duration_ms: 1000,
                    retryable: true,
                    max_retries: 3,
                }),
                parameters: spec.parameters.clone(),
                metadata: TaskMetadata::default(),
            };
            
            let node = TaskNode {
                id: subtask_id.clone(),
                task: subtask,
                parent_id: Some(parent_id.to_string()),
                children_ids: vec![],
                depth,
                status: TaskStatus::Pending,
                plan_info: TaskPlanInfo::default(),
            };
            
            network.tasks.insert(subtask_id.clone(), node);
            subtask_ids.push(subtask_id);
            
            // 添加边
            if let Some(order) = spec.order {
                if order > 0 && order <= subtask_ids.len() {
                    network.edges.push(TaskEdge {
                        from: subtask_ids[order - 1].clone(),
                        to: subtask_id.clone(),
                        edge_type: EdgeType::Sequential,
                    });
                }
            }
        }
        
        // 更新父节点的子任务
        if let Some(parent) = network.tasks.get_mut(parent_id) {
            parent.children_ids = subtask_ids.clone();
        }
        
        Ok(subtask_ids)
    }

    /// 构建 DAG
    fn build_dag(&self, network: &TaskNetwork) -> Result<DagPlan, PlannerError> {
        let mut dag_nodes = Vec::new();
        let mut dag_edges = Vec::new();
        let mut entry_points = Vec::new();
        let mut exit_points = Vec::new();
        
        // 只包含原始任务
        for (id, node) in &network.tasks {
            if let TaskType::Primitive(_) = &node.task.task_type {
                dag_nodes.push(DagNode {
                    id: id.clone(),
                    task: node.task.clone(),
                    earliest_start: 0,
                    latest_start: 0,
                    duration: 1000, // TODO: 从任务获取
                });
            }
        }
        
        // 转换边
        for edge in &network.edges {
            dag_edges.push(DagEdge {
                from: edge.from.clone(),
                to: edge.to.clone(),
                edge_type: edge.edge_type.clone(),
                delay: 0,
            });
        }
        
        // 找入口点（没有入边的节点）
        let all_targets: HashSet<_> = dag_edges.iter().map(|e| &e.to).collect();
        entry_points = dag_nodes
            .iter()
            .filter(|n| !all_targets.contains(&n.id))
            .map(|n| n.id.clone())
            .collect();
        
        // 找出口点（没有出边的节点）
        let all_sources: HashSet<_> = dag_edges.iter().map(|e| &e.from).collect();
        exit_points = dag_nodes
            .iter()
            .filter(|n| !all_sources.contains(&n.id))
            .map(|n| n.id.clone())
            .collect();
        
        // 拓扑排序检测
        self.check_dag_validity(&dag_nodes, &dag_edges)?;
        
        Ok(DagPlan {
            nodes: dag_nodes,
            edges: dag_edges,
            entry_points,
            exit_points,
        })
    }

    /// 检查 DAG 有效性
    fn check_dag_validity(&self, nodes: &[DagNode], edges: &[DagEdge]) -> Result<(), PlannerError> {
        // 构建邻接表
        let mut adj: HashMap<String, Vec<String>> = HashMap::new();
        for edge in edges {
            adj.entry(edge.from.clone()).or_default().push(edge.to.clone());
        }
        
        // DFS 检测环
        let mut visited: HashSet<String> = HashSet::new();
        let mut rec_stack: HashSet<String> = HashSet::new();
        
        fn has_cycle(
            node: &str,
            adj: &HashMap<String, Vec<String>>,
            visited: &mut HashSet<String>,
            rec_stack: &mut HashSet<String>,
        ) -> bool {
            visited.insert(node.to_string());
            rec_stack.insert(node.to_string());
            
            if let Some(neighbors) = adj.get(node) {
                for neighbor in neighbors {
                    if !visited.contains(neighbor) {
                        if has_cycle(neighbor, adj, visited, rec_stack) {
                            return true;
                        }
                    } else if rec_stack.contains(neighbor) {
                        return true;
                    }
                }
            }
            
            rec_stack.remove(node);
            false
        }
        
        for node in nodes {
            if !visited.contains(&node.id) {
                if has_cycle(&node.id, &adj, &mut visited, &mut rec_stack) {
                    return Err(PlannerError::CyclicDependency);
                }
            }
        }
        
        Ok(())
    }

    /// 重规划
    pub async fn replan(
        &self,
        previous_plan: &PlanResult,
        failed_task_id: &str,
        current_state: WorldState,
    ) -> Result<PlanResult, PlannerError> {
        // 获取失败任务
        let failed_task = previous_plan.task_network.tasks.get(failed_task_id)
            .ok_or_else(|| PlannerError::TaskNotFound(failed_task_id.to_string()))?;
        
        // 尝试其他方法
        let mut new_request = PlanRequest {
            root_task: failed_task.task.clone(),
            initial_state: current_state,
            goal_state: None,
            config_override: Some(PlannerConfig {
                backtrack_strategy: BacktrackStrategy::Intelligent,
                ..self.config.clone()
            }),
            context: PlanContext::default(),
        };
        
        // 如果原任务是复合任务，标记已尝试的方法
        if let TaskType::Compound(compound) = &failed_task.task.task_type {
            if let Some(method_id) = &failed_task.plan_info.selected_method {
                // TODO: 排除已失败的方法
            }
        }
        
        self.plan(new_request).await
    }
}

/// 规划器错误
#[derive(Debug, thiserror::Error)]
pub enum PlannerError {
    #[error("Task not found: {0}")]
    TaskNotFound(String),
    
    #[error("Max iterations reached")]
    MaxIterationsReached,
    
    #[error("Max depth exceeded")]
    MaxDepthExceeded,
    
    #[error("Cyclic dependency detected")]
    CyclicDependency,
    
    #[error("Decomposition failed: {0}")]
    DecompositionFailed(String),
    
    #[error("No applicable method found for task: {0}")]
    NoApplicableMethod(String),
    
    #[error("Invalid domain: {0}")]
    InvalidDomain(String),
}

// Domain module stub
pub mod domain {
    use super::*;
    
    #[derive(Debug, Clone, Default)]
    pub struct Domain {
        pub name: String,
        pub tasks: HashMap<String, Task>,
    }
}

pub mod decomposer {
    //! 任务分解器
    
    use super::*;
}

pub mod resolver {
    //! 冲突消解器
    
    use super::*;
}
