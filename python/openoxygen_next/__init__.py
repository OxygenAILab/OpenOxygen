"""
OpenOxygen Next - Vision-first Computer Use Agent with multi-agent orchestration

A next-generation framework for LLM-driven CLI and GUI automation.
"""

from __future__ import annotations

__version__ = "1.0.0"

# Core components
from openoxygen_next.orchestrator import TaskOrchestrator, TaskRequest, TaskResponse
from openoxygen_next.llm import LLMGateway, LLMConfig
from openoxygen_next.skills import SkillRegistry
from openoxygen_next.agents import AgentBridge, Agent, AgentType
from openoxygen_next.vision import VLMConnector, VlmProvider

__all__ = [
    # Version
    "__version__",
    # Core
    "TaskOrchestrator",
    "TaskRequest", 
    "TaskResponse",
    # LLM
    "LLMGateway",
    "LLMConfig",
    # Skills
    "SkillRegistry",
    # Agents
    "AgentBridge",
    "Agent",
    "AgentType",
    # Vision
    "VLMConnector",
    "VlmProvider",
    # Main class
    "OpenOxygen",
]


class OpenOxygen:
    """
    Main entry point for OpenOxygen Next.
    
    Example:
        >>> from openoxygen_next import OpenOxygen
        >>> 
        >>> agent = OpenOxygen(
        ...     llm_config={
        ...         "provider": "openai",
        ...         "api_key": "sk-...",
        ...         "model": "gpt-4o"
        ...     }
        ... )
        >>> 
        >>> result = await agent.execute(
        ...     "Open Chrome and search for 'AI news'"
        ... )
    """
    
    def __init__(
        self,
        llm_config: dict,
        working_directory: str | None = None,
        enable_gui: bool = True,
        enable_cli: bool = True,
        enable_multi_agent: bool = False,
        max_retries: int = 3,
    ):
        self._llm_config = llm_config
        self._working_directory = working_directory
        self._enable_gui = enable_gui
        self._enable_cli = enable_cli
        self._enable_multi_agent = enable_multi_agent
        self._max_retries = max_retries
        
        # Lazy initialization
        self._orchestrator: TaskOrchestrator | None = None
        self._agent_bridge: AgentBridge | None = None
    
    async def execute(
        self,
        description: str,
        *,
        context: str | None = None,
        constraints: list[str] | None = None,
        priority: str = "normal",
        mode: str = "auto",
    ) -> TaskResponse:
        """
        Execute a task described in natural language.
        
        Args:
            description: Natural language task description
            context: Additional context information
            constraints: List of task constraints
            priority: Task priority (critical, high, normal, low)
            mode: Execution mode (auto, gui, cli)
        
        Returns:
            Task execution result
        """
        # Initialize on first use
        if self._orchestrator is None:
            self._orchestrator = await self._init_orchestrator()
        
        request = TaskRequest(
            description=description,
            context=context,
            constraints=constraints or [],
            priority=priority,
            mode=mode,
        )
        
        return await self._orchestrator.execute(request)
    
    async def execute_stream(
        self,
        description: str,
        **kwargs,
    ):
        """
        Execute a task with streaming progress updates.
        
        Yields step results as they complete.
        """
        if self._orchestrator is None:
            self._orchestrator = await self._init_orchestrator()
        
        request = TaskRequest(
            description=description,
            **kwargs,
        )
        
        async for result in self._orchestrator.execute_stream(request):
            yield result
    
    async def collaborate(
        self,
        task: str,
        agents: list[str] | None = None,
    ) -> dict:
        """
        Collaborate with other agents to complete a task.
        
        Args:
            task: Task description
            agents: List of agent types to collaborate with
        
        Returns:
            Collaboration results from all participating agents
        """
        if not self._enable_multi_agent:
            raise RuntimeError("Multi-agent mode not enabled")
        
        if self._agent_bridge is None:
            self._agent_bridge = await self._init_agent_bridge()
        
        # Create collaboration task
        collaboration = await self._agent_bridge.create_collaboration(
            task_id=f"collab_{id(task)}",
            collaboration_type="parallel",
            required_capabilities=agents or [],
        )
        
        return {"collaboration_id": collaboration.task_id}
    
    async def _init_orchestrator(self) -> TaskOrchestrator:
        """Initialize the task orchestrator."""
        # Import Rust bindings
        try:
            from openoxygen_next._core import CoreRuntime
            runtime = CoreRuntime()
        except ImportError:
            runtime = None
        
        return TaskOrchestrator(
            llm_config=self._llm_config,
            runtime=runtime,
            enable_gui=self._enable_gui,
            enable_cli=self._enable_cli,
            max_retries=self._max_retries,
        )
    
    async def _init_agent_bridge(self) -> AgentBridge:
        """Initialize the agent bridge for multi-agent collaboration."""
        return AgentBridge(
            agent_type="orchestrator",
            capabilities=["coordination", "task_delegation"],
        )
    
    async def dispose(self):
        """Clean up resources."""
        if self._orchestrator:
            await self._orchestrator.dispose()
        if self._agent_bridge:
            await self._agent_bridge.stop()
    
    async def __aenter__(self):
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.dispose()
