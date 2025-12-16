// ... (保留头部 import) ...
import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RefreshCw, Activity, ChevronRight, Plus, Trash2, Save, Terminal, BarChart2, Cpu, Sliders, Key, Eye, EyeOff, Settings, FileCode } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';

// ... (保留 Card 和 InputGroup 组件不变) ...
const Card = ({ title, icon: Icon, children, className = "" }) => (
  <div className={`bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden flex flex-col ${className}`}>
    {title && (
      <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
        {Icon && <Icon size={16} className="text-blue-600" />}
        <h3 className="font-semibold text-slate-700 text-sm">{title}</h3>
      </div>
    )}
    <div className="p-4 flex-1">{children}</div>
  </div>
);

const InputGroup = ({ label, name, value, onChange, type = "number", step = "0.01", placeholder="", tooltip = "", className="", disabled=false }) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className={`flex flex-col space-y-0.5 ${className}`}>
      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1 truncate" title={label}>
        {label}
        {tooltip && <span className="text-slate-300 cursor-help" title={tooltip}>?</span>}
      </label>
      <div className="relative">
        <input
          type={inputType}
          name={name}
          value={value}
          onChange={onChange}
          step={type === 'number' ? step : undefined}
          disabled={disabled}
          placeholder={placeholder}
          className={`w-full px-2 py-1.5 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all hover:border-blue-300 bg-slate-50 focus:bg-white placeholder:text-slate-300 ${isPassword ? 'pr-8' : ''} ${disabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed border-slate-100' : ''}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
    </div>
  );
};

const LINE_COLORS = ['#10b981', '#f59e0b', '#6366f1', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];

export default function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [problemList, setProblemList] = useState([]);
  
  const logsEndRef = useRef(null);
  const abortControllerRef = useRef(null);
  
  const [config, setConfig] = useState({
    provider: "deepseek", 
    api_key: "",         
    base_url: "",       
    model: "deepseek-chat",
    temperature: 0.2,
    top_p: 0.9,
    max_tokens: 512,
    template_path: "Scripts/prompt_template_Chinese.md",
    
    max_iterations: 50,
    stagnation_limit: 10,
    retain_number: 5,
    num_initial_points: 20, 
    initial_sampling_method: "lhs", // 新增: 默认 LHS
    target_range_min: 0, 
    target_range_max: 100,
    
    reliability_target: "0.98", 
    N: 10000,
    threshold: 0,
    penalty_limit: 0.01,
    penalty_weight: 10000,
    
    std: "0.3464", 
    adition_point_std: "0.3464",
    adition_point_number: 10,
    verbose_perturbation: false, 

    problem_scenario: "", 
    verbose_backend: true,
    return_details: true,
  });

  const [variables, setVariables] = useState([
    { id: 1, name: 'x1', min: 0, max: 10 },
    { id: 2, name: 'x2', min: 0, max: 10 },
  ]);

  const [bestResult, setBestResult] = useState({
    point: [], cost: null, penalty: null, reliabilities: [], iteration: 0
  });

  // ... (保留 fetchProblems useEffect) ...
  useEffect(() => {
    const fetchProblems = async () => {
        try {
            const res = await fetch('http://localhost:5000/get_problems');
            if (!res.ok) throw new Error(`Server returned ${res.status}`);
            const data = await res.json();
            setProblemList(data);
            if (data.length > 0 && !config.problem_scenario) {
                handleScenarioChange({ target: { value: data[0].id } }); 
            }
        } catch (err) {
            console.error("Failed to fetch problems:", err);
            setLogs(prev => [...prev, `[Error] Could not connect to backend: ${err.message}. Is server.py running?`]);
        }
    };
    fetchProblems();
  }, []);

  const handleConfigChange = (e) => {
    const { name, value, type, checked } = e.target;
    const textFields = ['std', 'adition_point_std', 'reliability_target'];
    if (textFields.includes(name)) {
        setConfig(prev => ({ ...prev, [name]: value }));
    } else {
        setConfig(prev => ({
          ...prev,
          [name]: type === 'checkbox' ? checked : (type === 'number' ? (parseFloat(value) || value) : value)
        }));
    }
  };

  // ... (保留 handleScenarioChange, handleVarChange, addVariable, removeVariable) ...
  const handleScenarioChange = (e) => {
    const scenario = e.target.value;
    let newConfig = { ...config, problem_scenario: scenario };
    let newVariables = variables;

    if (scenario === 'math_2d_real') {
        newConfig = { ...newConfig, reliability_target: "0.98", max_iterations: 50, std: "0.3464", adition_point_std: "0.3464" };
        newVariables = [{ id: 1, name: 'x1', min: 0, max: 10 }, { id: 2, name: 'x2', min: 0, max: 10 }];
    } else if (scenario === 'car_crash_real') {
        const stdVec = `[${[0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.006, 0.006, 10, 10].join(', ')}]`;
        const pertVec = `[${[0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.006, 0.006, 0, 0].join(', ')}]`;
        newConfig = { ...newConfig, reliability_target: "0.9", max_iterations: 100, penalty_limit: 0.1, num_initial_points: 60, std: stdVec, adition_point_std: pertVec };
        newVariables = [];
        for (let i = 1; i <= 7; i++) newVariables.push({ id: i, name: `x${i}`, min: 0.5, max: 1.5 });
        for (let i = 8; i <= 9; i++) newVariables.push({ id: i, name: `x${i}`, min: 0.192, max: 0.345 });
    }
    setConfig(newConfig);
    setVariables(newVariables);
  };

  const handleVarChange = (id, field, value) => {
    setVariables(vars => vars.map(v => v.id === id ? { ...v, [field]: field === 'name' ? value : parseFloat(value) } : v));
  };
  const addVariable = () => {
    const newId = variables.length > 0 ? Math.max(...variables.map(v => v.id)) + 1 : 1;
    setVariables([...variables, { id: newId, name: `x${newId}`, min: 0, max: 10 }]);
  };
  const removeVariable = (id) => { setVariables(variables.filter(v => v.id !== id)); };

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const parseParam = (val) => {
      if (typeof val === 'string' && val.trim().startsWith('[')) {
          try { return JSON.parse(val); } catch (e) { return val; } 
      }
      return parseFloat(val) || val; 
  };

  const startOptimization = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setLogs([]);
    setChartData([]);
    setBestResult({ point: [], cost: null, penalty: null, reliabilities: [], iteration: 0 });
    abortControllerRef.current = new AbortController();

    try {
        const ranges = {};
        variables.forEach(v => { ranges[`${v.name}_range`] = [parseFloat(v.min), parseFloat(v.max)]; });

        const payload = {
            config: {
                ...config,
                std: parseParam(config.std),
                adition_point_std: parseParam(config.adition_point_std),
                reliability_target: parseParam(config.reliability_target)
            },
            ranges: ranges
        };

        setLogs(prev => [...prev, `>>> Scenario: ${config.problem_scenario}`, `>>> Sending Config...`]);

        const response = await fetch('http://localhost:5000/run_optimization', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP Error ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); 
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const msg = JSON.parse(line);
                    if (msg.type === 'log') setLogs(prev => [...prev, msg.msg]);
                    else if (msg.type === 'update') {
                        const relData = {};
                        const rels = Array.isArray(msg.reliabilities) ? msg.reliabilities : [msg.reliabilities];
                        rels.forEach((val, idx) => { relData[`rel_${idx}`] = val; });

                        setChartData(prev => [...prev, { 
                            iteration: msg.iteration, 
                            cost: msg.cost, 
                            penalty: msg.penalty,
                            ...relData
                        }]);
                        
                        setBestResult({ 
                            point: msg.point, 
                            cost: msg.cost, 
                            penalty: msg.penalty, 
                            reliabilities: rels, 
                            iteration: msg.iteration 
                        });
                    }
                } catch (e) { console.error(e); }
            }
        }
    } catch (err) {
        if (err.name !== 'AbortError') setLogs(prev => [...prev, `Error: ${err.message}`]);
    } finally {
        setIsRunning(false);
        abortControllerRef.current = null;
        setLogs(prev => [...prev, ">>> Done"]);
    }
  };

  const stopOptimization = () => { if (abortControllerRef.current) abortControllerRef.current.abort(); setIsRunning(false); };
  const resetOptimization = () => { stopOptimization(); setLogs([]); setChartData([]); setBestResult({ point: [], cost: null, penalty: null, reliabilities: [], iteration: 0 }); };

  const getReliabilityTargets = () => {
      const target = parseParam(config.reliability_target);
      if (Array.isArray(target)) return target;
      return [target];
  };

  return (
    <div className="h-screen bg-slate-50 text-slate-800 font-sans flex flex-col overflow-hidden">
      <header className="bg-white border-b border-slate-200 flex-none z-10">
        <div className="px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-1.5 rounded text-white shadow-sm"><Activity size={18} /></div>
            <h1 className="text-lg font-bold text-slate-800">LLM-RBDO <span className="text-slate-400 font-normal ml-1 text-sm">Console</span></h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-8 flex bg-slate-100 rounded-lg p-1 gap-1">
                <button onClick={startOptimization} disabled={isRunning} className={`flex items-center gap-1.5 px-3 rounded-md text-xs font-medium transition-all ${isRunning ? 'text-slate-400 cursor-not-allowed' : 'bg-white text-blue-700 shadow-sm hover:text-blue-800'}`}><Play size={14} /> Run</button>
                <button onClick={stopOptimization} disabled={!isRunning} className={`flex items-center gap-1.5 px-3 rounded-md text-xs font-medium transition-all ${!isRunning ? 'text-slate-400 cursor-not-allowed' : 'bg-white text-amber-600 shadow-sm hover:text-amber-700'}`}><Pause size={14} /> Pause</button>
            </div>
            <button onClick={resetOptimization} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"><RefreshCw size={18} /></button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <aside className="w-[360px] flex-none bg-white border-r border-slate-200 flex flex-col overflow-hidden">
           <div className="p-3 border-b border-slate-100 bg-slate-50/50"><h2 className="text-xs font-bold text-slate-500 uppercase">Configuration</h2></div>
           <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            
            <Card title="Client Configuration" icon={Key}>
              <div className="space-y-3">
                <select name="provider" value={config.provider} onChange={handleConfigChange} className="w-full text-xs border border-slate-200 rounded p-1.5 bg-slate-50"><option value="deepseek">DeepSeek</option><option value="siliconflow">SiliconFlow</option><option value="openai">OpenAI</option></select>
                <InputGroup label="API Key" name="api_key" value={config.api_key} onChange={handleConfigChange} type="password" placeholder="Env: _API_KEY" />
                <InputGroup label="Base URL" name="base_url" value={config.base_url} onChange={handleConfigChange} type="text" />
              </div>
            </Card>

            <Card title="Problem Logic" icon={FileCode}>
              <div className="space-y-3">
                <select name="problem_scenario" value={config.problem_scenario} onChange={handleScenarioChange} className="w-full text-xs border border-slate-200 rounded p-1.5 bg-slate-50 font-medium">
                    {problemList.length === 0 && <option value="" disabled>Loading scenarios...</option>}
                    {problemList.map(prob => (<option key={prob.id} value={prob.id}>{prob.name}</option>))}
                </select>
              </div>
            </Card>

            <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
              <div className="flex justify-between items-center mb-2"><div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Sliders size={14} /> Design Variables</div><button onClick={addVariable} className="text-blue-600 hover:bg-blue-100 p-1 rounded"><Plus size={14} /></button></div>
              <div className="space-y-2">{variables.map((v) => (<div key={v.id} className="grid grid-cols-12 gap-1 items-center bg-white border border-slate-200 rounded px-2 py-1.5 shadow-sm"><div className="col-span-3 font-mono text-xs font-bold text-center bg-slate-100 rounded py-1">{v.name}</div><input className="col-span-4 bg-transparent text-xs text-center border-b border-dashed border-slate-300 focus:border-blue-500 outline-none" value={v.min} onChange={(e) => handleVarChange(v.id, 'min', e.target.value)} /><span className="col-span-1 text-center text-slate-400 text-xs">~</span><input className="col-span-3 bg-transparent text-xs text-center border-b border-dashed border-slate-300 focus:border-blue-500 outline-none" value={v.max} onChange={(e) => handleVarChange(v.id, 'max', e.target.value)} /><button onClick={() => removeVariable(v.id)} className="col-span-1 flex justify-end text-slate-300 hover:text-red-500"><Trash2 size={12} /></button></div>))}</div>
            </div>

            <Card title="Optimization & Init" icon={BarChart2}>
              <div className="grid grid-cols-2 gap-3">
                <InputGroup label="Max Iter" name="max_iterations" value={config.max_iterations} onChange={handleConfigChange} />
                <InputGroup label="Stagnation" name="stagnation_limit" value={config.stagnation_limit} onChange={handleConfigChange} />
                <InputGroup label="Init Points" name="num_initial_points" value={config.num_initial_points} onChange={handleConfigChange} />
                
                {/* --- 新增：初始采样方法选择 --- */}
                <div className="flex flex-col space-y-0.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1">Init Method</label>
                  <select name="initial_sampling_method" value={config.initial_sampling_method} onChange={handleConfigChange} className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs bg-slate-50">
                    <option value="lhs">LHS (Latin Hypercube)</option>
                    <option value="random">Random Uniform</option>
                    <option value="llm">LLM Prompting</option>
                  </select>
                </div>
                
                <InputGroup label="History" name="retain_number" value={config.retain_number} onChange={handleConfigChange} />
              </div>
            </Card>

            <Card title="Constraints & Sampling" icon={Activity}>
               <div className="grid grid-cols-2 gap-3">
                 <div className="col-span-2"><InputGroup label="Reliability Target (Scalar/Vector)" name="reliability_target" value={config.reliability_target} onChange={handleConfigChange} type="text" /></div>
                 <InputGroup label="MC Samples" name="N" value={config.N} onChange={handleConfigChange} step="100" />
                 <div className="col-span-2"><InputGroup label="Evaluate Std (Scalar/Vector)" name="std" value={config.std} onChange={handleConfigChange} type="text" /></div>
                 <InputGroup label="Threshold" name="threshold" value={config.threshold} onChange={handleConfigChange} />
                 <InputGroup label="Penalty Limit" name="penalty_limit" value={config.penalty_limit} onChange={handleConfigChange} />
                 <InputGroup label="Penalty Weight" name="penalty_weight" value={config.penalty_weight} onChange={handleConfigChange} step="10" />
               </div>
            </Card>

            {/* ... 省略 LLM 和 Perturbation 卡片 (保持不变) ... */}
            <Card title="LLM" icon={Cpu}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                   <div className="col-span-2"><select name="model" value={config.model} onChange={handleConfigChange} className="w-full text-xs border border-slate-200 rounded p-1.5 bg-slate-50"><option value="deepseek-chat">DeepSeek Chat</option><option value="gpt-4">GPT-4</option><option value="gpt-3.5-turbo">GPT-3.5 Turbo</option><option value="claude-3">Claude 3</option></select></div>
                   <InputGroup label="Temp" name="temperature" value={config.temperature} onChange={handleConfigChange} />
                   <InputGroup label="Top P" name="top_p" value={config.top_p} onChange={handleConfigChange} />
                </div>
                <InputGroup label="Template Path" name="template_path" value={config.template_path} onChange={handleConfigChange} type="text" />
              </div>
            </Card>
            
            <Card title="Perturbation" icon={Activity}>
              <div className="grid grid-cols-1 gap-3 mb-2">
                <InputGroup label="Perturb Std (Scalar/Vector)" name="adition_point_std" value={config.adition_point_std} onChange={handleConfigChange} type="text" />
                <InputGroup label="Perturb Count" name="adition_point_number" value={config.adition_point_number} onChange={handleConfigChange} />
              </div>
            </Card>
           </div>
        </aside>

        {/* ... (右侧面板保持不变) ... */}
        <section className="flex-1 flex flex-col min-w-0 bg-slate-50/30">
          <div className="p-4 grid grid-cols-4 gap-4 flex-none">
             <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm"><div className="text-slate-400 text-[10px] font-bold uppercase">Iteration</div><div className="text-2xl font-light text-slate-700 mt-1">{bestResult.iteration} <span className="text-sm text-slate-300">/ {config.max_iterations}</span></div></div>
             <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm"><div className="text-slate-400 text-[10px] font-bold uppercase">Best Cost</div><div className="text-2xl font-medium text-emerald-600 mt-1">{bestResult.cost ? bestResult.cost.toFixed(4) : "--"}</div></div>
             <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm"><div className="text-slate-400 text-[10px] font-bold uppercase">Reliability</div><div className={`text-xl font-light mt-1 truncate ${Math.min(...bestResult.reliabilities) >= parseParam(config.reliability_target) ? 'text-blue-600' : 'text-amber-500'}`} title={bestResult.reliabilities.join(', ')}>{bestResult.reliabilities.length > 0 ? (bestResult.reliabilities.length > 1 ? `[${bestResult.reliabilities.map(r=>r.toFixed(3)).join(', ')}]` : bestResult.reliabilities[0].toFixed(4)) : "--"}</div></div>
             <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm"><div className="text-slate-400 text-[10px] font-bold uppercase">Current Penalty</div><div className={`text-2xl font-light mt-1 ${bestResult.penalty > 0 ? 'text-red-500' : 'text-slate-300'}`}>{bestResult.penalty !== null ? bestResult.penalty.toFixed(4) : "--"}</div></div>
          </div>
          <div className="px-4 flex-1 min-h-0 flex flex-col">
            <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 h-full flex flex-col">
              <h3 className="text-xs font-bold text-slate-500 mb-4 flex items-center gap-2"><Activity size={14} /> OPTIMIZATION HISTORY</h3>
              
              <div className="flex-1 min-h-0 grid grid-cols-2 gap-4">
                
                {/* 左边：目标函数图表 */}
                <div className="h-full flex flex-col">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2 text-center">Objective Cost</h4>
                    <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="iteration" tick={{fill: '#94a3b8', fontSize: 10}} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                            <YAxis tick={{fill: '#94a3b8', fontSize: 10}} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} domain={['auto', 'auto']} />
                            <Tooltip contentStyle={{ borderRadius: '6px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }} />
                            <Line type="monotone" dataKey="cost" stroke="#2563eb" strokeWidth={2} dot={false} activeDot={{ r: 4 }} name="Cost" animationDuration={300} />
                        </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* 右边：可靠性图表 (动态多线) */}
                <div className="h-full flex flex-col border-l border-slate-100 pl-4">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2 text-center">Constraint Reliabilities</h4>
                    <div className="flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="iteration" tick={{fill: '#94a3b8', fontSize: 10}} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                            <YAxis 
                                tick={{fill: '#94a3b8', fontSize: 10}} 
                                axisLine={{ stroke: '#cbd5e1' }} 
                                tickLine={false} 
                                domain={[0.8, 1.0]} 
                                allowDataOverflow={false}
                            />
                            {getReliabilityTargets().map((target, idx) => (
                                <ReferenceLine key={`ref-${idx}`} y={target} stroke="#ef4444" strokeDasharray="3 3" label={{ position: 'right', value: 'T', fill: '#ef4444', fontSize: 8 }} />
                            ))}
                            <Tooltip contentStyle={{ borderRadius: '6px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }} />
                            <Legend wrapperStyle={{fontSize: '10px'}} iconType='circle' />
                            {chartData.length > 0 && Object.keys(chartData[0])
                                .filter(key => key.startsWith('rel_'))
                                .map((key, index) => (
                                    <Line 
                                        key={key}
                                        type="monotone" 
                                        dataKey={key} 
                                        stroke={LINE_COLORS[index % LINE_COLORS.length]} 
                                        strokeWidth={2} 
                                        dot={false} 
                                        activeDot={{ r: 4 }} 
                                        name={`Con ${index + 1}`} 
                                        animationDuration={300} 
                                    />
                                ))
                            }
                        </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

              </div>
            </div>
          </div>
          <div className="p-4 h-60 flex-none grid grid-cols-12 gap-4">
            <div className="col-span-5 bg-white border border-slate-200 rounded-lg shadow-sm p-4 overflow-y-auto"><h3 className="text-xs font-bold text-slate-500 mb-3 uppercase">Best Design Point</h3>{bestResult.point.length > 0 ? (<div className="space-y-1">{bestResult.point.map((val, idx) => (<div key={idx} className="flex justify-between items-center py-1 border-b border-slate-50 last:border-0"><span className="text-xs font-medium text-slate-600">{variables[idx]?.name || `x${idx+1}`}</span><span className="text-xs font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{val}</span></div>))}<div className="pt-2 mt-2 border-t border-dashed border-slate-200 flex justify-between"><span className="text-xs text-slate-400">Reliability</span><span className="text-xs font-mono text-slate-700" title={bestResult.reliabilities.join(', ')}>{bestResult.reliabilities.length > 3 ? `[${bestResult.reliabilities[0].toFixed(3)}... +${bestResult.reliabilities.length-1}]` : bestResult.reliabilities.map(r=>r.toFixed(3)).join(', ')}</span></div></div>) : (<div className="h-full flex items-center justify-center text-slate-300 text-xs italic">No data yet</div>)}</div>
            <div className="col-span-7 bg-slate-900 rounded-lg shadow-sm p-3 flex flex-col font-mono text-[11px] text-slate-300 overflow-hidden"><div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-800 text-slate-500"><Terminal size={12} /> Console Output</div><div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">{logs.map((log, i) => (<div key={i} className="break-all leading-tight opacity-90 hover:opacity-100"><span className="text-blue-500 mr-1.5">{'>'}</span>{log}</div>))}<div ref={logsEndRef} /></div></div>
          </div>
        </section>
      </main>
    </div>
  );
}