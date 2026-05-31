//! OpenOxygen Next - Multi-Agent Communication Bridge
//! 
//! 对标 OpenClaw 的多 Agent 通信机制
//! 支持 Agent 发现、消息路由、协作编排

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub mod discovery;
pub mod messaging;
pub mod coordination;

/// Agent 实例
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub agent_type: AgentType,
    pub capabilities: Vec<Capability>,
    pub status: AgentStatus,
    pub endpoint: String,
    pub metadata: HashMap<String, serde_json::Value>,
    pub registered_at: chrono::DateTime<chrono::Utc>,
    pub last_heartbeat: chrono::DateTime<chrono::Utc>,
}

/// Agent 类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentType {
    /// 主控 Agent - 负责任务分发
    Orchestrator,
    /// GUI Agent - 专精图形界面操作
    GuiSpecialist,
    /// CLI Agent - 专精命令行操作
    CliSpecialist,
    /// 浏览器 Agent - 专精 Web 自动化
    BrowserSpecialist,
    /// 代码 Agent - 专精代码操作
    CodeSpecialist,
    /// 分析 Agent - 专精数据分析
    AnalysisSpecialist,
    /// 通用 Worker
    Worker,
    /// 外部 Agent（第三方服务）
    External,
}

/// Agent 状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Online,
    Busy,
    Offline,
    Error,
}

/// Agent 能力
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Capability {
    pub name: String,
    pub version: String,
    pub description: String,
}

/// Agent 消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub id: String,
    pub sender: String,
    pub receiver: String, // "*" 表示广播
    pub message_type: MessageType,
    pub payload: serde_json::Value,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub priority: MessagePriority,
    pub correlation_id: Option<String>, // 关联消息 ID，用于追踪对话
}

/// 消息类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type", content = "data")]
pub enum MessageType {
    /// 任务分配
    TaskAssignment { task_id: String, description: String, deadline: Option<chrono::DateTime<chrono::Utc>> },
    /// 任务结果
    TaskResult { task_id: String, success: bool, output: serde_json::Value },
    /// 任务状态查询
    TaskQuery { task_id: String },
    /// 心跳
    Heartbeat,
    /// Agent 注册
    Registration { agent_info: Agent },
    /// Agent 注销
    UnRegistration { agent_id: String },
    /// 能力查询
    CapabilityQuery { required: Vec<Capability> },
    /// 能力响应
    CapabilityResponse { available: bool, matched_capabilities: Vec<Capability> },
    /// 协作请求
    CollaborationRequest { task_id: String, collaboration_type: CollaborationType },
    /// 协作响应
    CollaborationResponse { accepted: bool, agent_id: String },
    /// 事件广播
    Event { event_type: String, data: serde_json::Value },
    /// 状态更新
    StatusUpdate { status: AgentStatus, current_task: Option<String> },
    /// 资源请求
    ResourceRequest { resource_type: String, amount: usize },
    /// 自定义消息
    Custom { name: String, data: serde_json::Value },
}

/// 协作类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CollaborationType {
    /// 并行执行 - 多个 Agent 同时处理不同部分
    Parallel,
    /// 顺序执行 - Agent A 完成后 Agent B 开始
    Sequential,
    /// 竞争执行 - 多个 Agent 同时执行，取最快结果
    Competitive,
    /// 投票决策 - 多个 Agent 投票决策
    Voting,
    /// 主从模式 - 一个主 Agent 协调多个从 Agent
    MasterSlave,
}

/// 消息优先级
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum MessagePriority {
    Low = 0,
    Normal = 1,
    High = 2,
    Critical = 3,
}

/// Agent 桥接器
pub struct AgentBridge {
    /// 本机 Agent ID
    self_id: String,
    /// 已注册 Agent
    agents: Arc<RwLock<HashMap<String, Agent>>>,
    /// 消息发送通道
    message_tx: mpsc::Sender<AgentMessage>,
    /// 消息接收通道
    message_rx: Arc<RwLock<mpsc::Receiver<AgentMessage>>>,
    /// 订阅者映射
    subscribers: Arc<RwLock<HashMap<String, mpsc::Sender<AgentMessage>>>>,
    /// 运行状态
    running: Arc<RwLock<bool>>,
}

/// 协作任务
#[derive(Debug, Clone)]
pub struct CollaborationTask {
    pub task_id: String,
    pub participants: Vec<String>,
    pub collaboration_type: CollaborationType,
    pub sub_tasks: Vec<SubTask>,
    pub results: HashMap<String, TaskResult>,
    pub deadline: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// 子任务
#[derive(Debug, Clone)]
pub struct SubTask {
    pub id: String,
    pub assignee: String,
    pub description: String,
    pub dependencies: Vec<String>,
    pub status: TaskStatus,
}

/// 任务状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Assigned,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

/// 任务结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskResult {
    pub task_id: String,
    pub agent_id: String,
    pub success: bool,
    pub output: serde_json::Value,
    pub completed_at: chrono::DateTime<chrono::Utc>,
    pub metrics: TaskMetrics,
}

/// 任务指标
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskMetrics {
    pub execution_time_ms: u64,
    pub resource_usage: ResourceUsage,
}

/// 资源使用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceUsage {
    pub cpu_percent: f32,
    pub memory_mb: u64,
    pub network_bytes: u64,
}

impl AgentBridge {
    /// 创建新的 Agent 桥接器
    pub fn new(self_agent: Agent) -> Result<Self, AgentBridgeError> {
        let (message_tx, message_rx) = mpsc::channel(1024);
        
        Ok(Self {
            self_id: self_agent.id.clone(),
            agents: Arc::new(RwLock::new(HashMap::from([(self_agent.id.clone(), self_agent)])),
            message_tx,
            message_rx: Arc::new(RwLock::new(message_rx)),
            subscribers: Arc::new(RwLock::new(HashMap::new())),
            running: Arc::new(RwLock::new(false)),
        })
    }

    /// 启动桥接器
    pub async fn start(&self) -> Result<(), AgentBridgeError> {
        *self.running.write().await = true;
        
        // 启动消息处理循环
        let message_rx = self.message_rx.clone();
        let subscribers = self.subscribers.clone();
        let agents = self.agents.clone();
        let running = self.running.clone();
        
        tokio::spawn(async move {
            while *running.read().await {
                if let Ok(message) = message_rx.write().await.try_recv() {
                    // 路由消息
                    Self::route_message(message, &subscribers, &agents).await;
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;
            }
        });
        
        // 启动心跳
        self.start_heartbeat().await;
        
        Ok(())
    }

    /// 发送消息
    pub async fn send(&self, mut message: AgentMessage) -> Result<(), AgentBridgeError> {
        message.id = Uuid::new_v4().to_string();
        message.timestamp = chrono::Utc::now();
        
        self.message_tx.send(message).await
            .map_err(|_| AgentBridgeError::SendError)?;
        
        Ok(())
    }

    /// 广播消息
    pub async fn broadcast(
        &self, 
        sender: String,
        message_type: MessageType,
        priority: MessagePriority
    ) -> Result<(), AgentBridgeError> {
        let agents = self.agents.read().await;
        
        for agent_id in agents.keys() {
            if *agent_id == sender {
                continue;
            }
            
            let message = AgentMessage {
                id: Uuid::new_v4().to_string(),
                sender: sender.clone(),
                receiver: agent_id.clone(),
                message_type: message_type.clone(),
                payload: serde_json::Value::Null,
                timestamp: chrono::Utc::now(),
                priority: priority.clone(),
                correlation_id: None,
            };
            
            self.message_tx.send(message).await.ok();
        }
        
        Ok(())
    }

    /// 订阅消息
    pub async fn subscribe(&self, agent_id: String) -> mpsc::Receiver<AgentMessage> {
        let (tx, rx) = mpsc::channel(100);
        self.subscribers.write().await.insert(agent_id, tx);
        rx
    }

    /// 注册 Agent
    pub async fn register_agent(&self, agent: Agent) -> Result<(), AgentBridgeError> {
        self.agents.write().await.insert(agent.id.clone(), agent);
        
        // 广播新 Agent 注册
        self.broadcast(
            self.self_id.clone(),
            MessageType::Event {
                event_type: "agent_registered".to_string(),
                data: serde_json::json!({"agent_id": agent.id}),
            },
            MessagePriority::Normal,
        ).await.ok();
        
        Ok(())
    }

    /// 注销 Agent
    pub async fn unregister_agent(&self, agent_id: &str) -> Result<(), AgentBridgeError> {
        self.agents.write().await.remove(agent_id);
        
        self.broadcast(
            self.self_id.clone(),
            MessageType::Event {
                event_type: "agent_unregistered".to_string(),
                data: serde_json::json!({"agent_id": agent_id}),
            },
            MessagePriority::Normal,
        ).await.ok();
        
        Ok(())
    }

    /// 查找具有特定能力的 Agent
    pub async fn find_agents_by_capability(
        &self, 
        capability: &Capability
    ) -> Vec<Agent> {
        let agents = self.agents.read().await;
        
        agents.values()
            .filter(|agent| {
                agent.status == AgentStatus::Online &&
                agent.capabilities.iter().any(|c| c.name == capability.name)
            })
            .cloned()
            .collect()
    }

    /// 创建协作任务
    pub async fn create_collaboration(
        &self,
        task_id: String,
        collaboration_type: CollaborationType,
        required_capabilities: Vec<Capability>,
    ) -> Result<CollaborationTask, AgentBridgeError> {
        // 查找合适的 Agent
        let mut participants = vec![self.self_id.clone()];
        
        for cap in &required_capabilities {
            let capable_agents = self.find_agents_by_capability(cap).await;
            if !capable_agents.is_empty() {
                participants.push(capable_agents[0].id.clone());
            }
        }
        
        // 发送协作请求
        for agent_id in &participants {
            if *agent_id == self.self_id {
                continue;
            }
            
            self.send(AgentMessage {
                id: Uuid::new_v4().to_string(),
                sender: self.self_id.clone(),
                receiver: agent_id.clone(),
                message_type: MessageType::CollaborationRequest {
                    task_id: task_id.clone(),
                    collaboration_type: collaboration_type.clone(),
                },
                payload: serde_json::to_value(&required_capabilities)?,
                timestamp: chrono::Utc::now(),
                priority: MessagePriority::High,
                correlation_id: Some(task_id.clone()),
            }).await?;
        }
        
        Ok(CollaborationTask {
            task_id,
            participants,
            collaboration_type,
            sub_tasks: vec![],
            results: HashMap::new(),
            deadline: None,
            created_at: chrono::Utc::now(),
        })
    }

    /// 路由消息到订阅者
    async fn route_message(
        message: AgentMessage,
        subscribers: &Arc<RwLock<HashMap<String, mpsc::Sender<AgentMessage>>>>,
        _agents: &Arc<RwLock<HashMap<String, Agent>>>,
    ) {
        let subs = subscribers.read().await;
        
        if message.receiver == "*" {
            // 广播到所有订阅者
            for (agent_id, tx) in subs.iter() {
                if *agent_id != message.sender {
                    tx.send(message.clone()).await.ok();
                }
            }
        } else if let Some(tx) = subs.get(&message.receiver) {
            // 单播到指定订阅者
            tx.send(message).await.ok();
        }
    }

    /// 启动心跳
    async fn start_heartbeat(&self) {
        let message_tx = self.message_tx.clone();
        let self_id = self.self_id.clone();
        let running = self.running.clone();
        
        tokio::spawn(async move {
            while *running.read().await {
                let heartbeat = AgentMessage {
                    id: Uuid::new_v4().to_string(),
                    sender: self_id.clone(),
                    receiver: "*".to_string(),
                    message_type: MessageType::Heartbeat,
                    payload: serde_json::Value::Null,
                    timestamp: chrono::Utc::now(),
                    priority: MessagePriority::Normal,
                    correlation_id: None,
                };
                
                message_tx.send(heartbeat).await.ok();
                tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            }
        });
    }

    /// 获取在线 Agent 列表
    pub async fn get_online_agents(&self) -> Vec<Agent> {
        let agents = self.agents.read().await;
        agents.values()
            .filter(|a| a.status == AgentStatus::Online)
            .cloned()
            .collect()
    }

    /// 更新本机 Agent 状态
    pub async fn update_self_status(&self, status: AgentStatus, current_task: Option<String>) {
        let mut agents = self.agents.write().await;
        if let Some(agent) = agents.get_mut(&self.self_id) {
            agent.status = status.clone();
            agent.last_heartbeat = chrono::Utc::now();
        }
        
        // 广播状态更新
        self.broadcast(
            self.self_id.clone(),
            MessageType::StatusUpdate { status, current_task },
            MessagePriority::Normal,
        ).await.ok();
    }

    /// 停止桥接器
    pub async fn stop(&self) {
        *self.running.write().await = false;
    }
}

/// Agent 桥接器错误
#[derive(Debug, thiserror::Error)]
pub enum AgentBridgeError {
    #[error("Send error")]
    SendError,
    
    #[error("Agent not found: {0}")]
    AgentNotFound(String),
    
    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
    
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

// Stub modules
pub mod discovery {
    //! Agent 发现服务
    
    use super::*;
    
    pub struct DiscoveryService;
    
    impl DiscoveryService {
        pub async fn discover() -> Vec<Agent> {
            vec![]
        }
    }
}

pub mod messaging {
    //! 消息传输实现
    
    use super::*;
}

pub mod coordination {
    //! 协调服务
    
    use super::*;
}
