# LLM-RBDO: 基于大语言模型的可靠性设计优化系统

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## 项目简介

**LLM-RBDO** 是一个创新性的可靠性设计优化（Reliability-Based Design Optimization）系统，结合了大语言模型（LLM）的智能推理能力与传统工程优化方法。该系统通过 LLM 生成候选设计点，结合蒙特卡洛可靠性分析，实现在满足可靠性约束的前提下最小化目标函数。

### 核心特性

- **LLM 驱动的优化**：利用 LLM 理解优化历史并智能生成新的候选设计点
- **多种初始采样方法**：支持拉丁超立方采样（LHS）、随机采样、LLM 提示采样
- **实时可视化**：流式更新优化进度，实时展示目标函数和可靠性曲线
- **多约束支持**：支持任意数量的约束条件和向量化可靠性目标
- **灵活的问题定义**：可扩展的问题注册表，易于添加新的优化场景
- **多 LLM 提供商**：支持 OpenAI、DeepSeek、SiliconFlow 等多个 API 服务

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React + Vite)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ 参数配置面板 │  │  实时图表   │  │   控制台日志输出    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │ HTTP/NDJSON Stream
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend (Flask API)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │ LLM Ops  │  │ RBDO Core│  │ Problems │  │ API Client  │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              LLM Provider (OpenAI/DeepSeek/SiliconFlow)     │
└─────────────────────────────────────────────────────────────┘
```

## 目录结构

```
RBDO_Agent/
├── app.py                      # Flask 后端主入口
├── pyproject.toml              # Python 项目配置与依赖
├── uv.lock                     # 依赖锁定文件
├── .env                        # 环境变量配置（API Keys）
│
├── Scripts/                    # 核心算法模块
│   ├── api_client.py           # LLM API 客户端封装
│   ├── llm_ops.py              # LLM 操作：生成设计点、初始采样
│   ├── rbdo_utils.py           # RBDO 核心：可靠性分析、惩罚计算
│   ├── mapping_utils.py        # 设计空间映射工具
│   ├── problems.py             # 优化问题注册表
│   └── prompt_template_*.md    # LLM 提示词模板
│
└── rbdo-frontend/              # React 前端
    ├── src/
    │   ├── App.jsx             # 主应用组件
    │   ├── main.jsx            # 入口文件
    │   └── index.css           # 全局样式
    ├── package.json            # 前端依赖
    └── vite.config.js          # Vite 配置
```

## 快速开始

### 环境要求

- **Python**: >= 3.10
- **Node.js**: >= 18.0
- **包管理器**: 推荐使用 [uv](https://github.com/astral-sh/uv)（Python）和 npm（Node.js）

### 1. 克隆项目

```bash
git clone https://github.com/backtime1/Visual-LLM-RBDO.git
cd Visual-LLM-RBDO
```

### 2. 配置环境变量

在项目根目录创建 `.env` 文件：

```env
# 选择你使用的 LLM 提供商，配置对应的 API Key

# DeepSeek (推荐，性价比高)
DEEPSEEK_API_KEY=your_deepseek_api_key_here

# OpenAI
OPENAI_API_KEY=your_openai_api_key_here

# SiliconFlow
SILICONFLOW_API_KEY=your_siliconflow_api_key_here
```

### 3. 安装后端依赖

**使用 uv（推荐）**

```bash
# 安装 uv（如果尚未安装）
  - 官方安装文档：`https://docs.astral.sh/uv/getting-started/installation/`
  - Windows 快速安装示例：
    - `powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"`

# 同步依赖
uv sync
```


### 4. 安装前端依赖

```bash
cd rbdo-frontend
npm install
```

### 5. 启动服务

**启动后端（终端 1）**

```bash
# 在项目根目录
python app.py
# 或使用 uv
uv run python app.py
```

后端将在 `http://localhost:5000` 启动

**启动前端（终端 2）**

```bash
cd rbdo-frontend
npm run dev
```

前端将在 `http://localhost:5173` 启动

### 6. 访问应用

打开浏览器访问 `http://localhost:5173`，即可看到 LLM-RBDO 控制台界面。

## 使用指南

### 界面概览

| 区域 | 功能 |
|------|------|
| **Client Configuration** | 配置 LLM 提供商和 API Key |
| **Problem Logic** | 选择优化问题场景 |
| **Design Variables** | 定义设计变量及其范围 |
| **Optimization & Init** | 设置迭代次数、初始采样方法等 |
| **Constraints & Sampling** | 配置可靠性目标、蒙特卡洛样本数等 |
| **LLM** | 配置模型参数（温度、Top-P 等） |
| **Perturbation** | 局部搜索扰动参数 |

### 内置优化问题

1. **2D Math Case (Real)**
   - 2 个设计变量，3 个约束
   - 目标函数：`f(x) = x1 + x2`
   - 适合快速测试

2. **Car Crash (11D Real)**
   - 9 个设计变量（扩展到 11 维）
   - 10 个约束条件
   - 汽车碰撞优化基准问题

### 初始采样方法

| 方法 | 说明 |
|------|------|
| **LHS** | 拉丁超立方采样，均匀覆盖设计空间（默认） |
| **Random** | 随机均匀采样 |
| **LLM** | 使用 LLM 生成多样化的初始点 |

### 运行优化

1. 配置 API Key（或在 `.env` 中预设）
2. 选择问题场景
3. 调整参数（可使用默认值）
4. 点击 **Run** 按钮开始优化
5. 实时观察图表和日志输出


## 扩展开发

### 添加新的优化问题

在 `Scripts/problems.py` 中注册新问题：

```python
def my_obj(x):
    """目标函数"""
    return x[0]**2 + x[1]**2

def my_con(X):
    """约束函数 (批量计算)
    返回形状: (N, num_constraints)
    正值表示满足约束
    """
    return X[:, 0] + X[:, 1] - 1

PROBLEM_REGISTRY['my_problem'] = {
    'obj': my_obj,
    'con': my_con,
    'expand': None  # 可选：维度扩展函数
}
```

### 自定义 LLM 提示词

编辑 `Scripts/prompt_template_*.md` 文件，支持以下占位符：

| 占位符 | 含义 |
|--------|------|
| `<<VARIABLE_NAMES>>` | 设计变量名列表 |
| `<<RANGES>>` | 变量范围 |
| `<<HISTORY>>` | 优化历史记录 |
| `<<BEST>>` | 当前最优点信息 |
| `<<OUTPUT_SCHEMA>>` | 输出 JSON 格式 |



