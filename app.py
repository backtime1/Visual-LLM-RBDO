"""
LLM-RBDO Backend Server (Robust LHS & Dynamic Problem Loading)
"""

import numpy as np
import json
import os
import sys
import traceback
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
from scipy.stats import qmc  # 引入 LHS 采样工具

# 确保能导入 Scripts 模块
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.append(current_dir)

try:
    from Scripts.api_client import create_client
    # 导入新的采样函数
    from Scripts.llm_ops import (
        generate_new_point_with_llm, 
        generate_initial_points_random,
        generate_initial_points_lhs,
        generate_initial_points_llm
    )
    from Scripts.rbdo_utils import penalized_cost
    from Scripts.mapping_utils import map_float_to_int_array
    from Scripts.problems import PROBLEM_REGISTRY
except ImportError as e:
    print(f"Error importing modules: {e}")
    sys.exit(1)

app = Flask(__name__)
CORS(app)

# --- 新增接口：获取所有可用问题 ---
@app.route('/get_problems', methods=['GET'])
def get_problems():
    problems = []
    for key in PROBLEM_REGISTRY.keys():
        display_name = key.replace('_', ' ').title()
        if key == 'math_2d_real': display_name = "2D Math Case (Real)"
        if key == 'car_crash_real': display_name = "Car Crash (11D Real)"
        problems.append({"id": key, "name": display_name})
    return jsonify(problems)

@app.route('/run_optimization', methods=['POST'])
def run_optimization():
    # 1. 解析请求数据
    try:
        data = request.json
        config = data.get('config', {})
        ranges_raw = data.get('ranges', {})
    except Exception as e:
        return jsonify({"error": f"Invalid JSON data: {str(e)}"}), 400
    
    # 2. 初始化 LLM Client
    try:
        client = create_client(config.get('provider'), config.get('api_key'), config.get('base_url'))
    except Exception as e:
        return jsonify({"error": f"Client Init Failed: {str(e)}"}), 400
        
    # 3. 加载场景
    scenario_id = config.get('problem_scenario', 'math_2d_real')
    
    if scenario_id not in PROBLEM_REGISTRY:
        return jsonify({"error": f"Unknown scenario: {scenario_id}"}), 400
        
    problem_def = PROBLEM_REGISTRY[scenario_id]
    obj_fn = problem_def['obj']
    con_fn = problem_def['con']
    expand_point = problem_def['expand']
    
    # 4. 解析标准差参数
    def process_std_input(val):
        if isinstance(val, list):
            return np.array(val)
        try:
            return float(val)
        except:
            return 0.05 # Fallback

    current_std = process_std_input(config.get('std', 0.05))
    current_adition_std = process_std_input(config.get('adition_point_std', 0.1))
    
    print(f">>> Scenario: {scenario_id}")

    # 5. --- 初始点生成 (支持三种模式) ---
    init_sampling_method = config.get('initial_sampling_method', 'lhs') # 默认 LHS
    num_init = int(config.get('num_initial_points', 20))
    target_range = [config.get('target_range_min', 0), config.get('target_range_max', 100)]
    
    # 预先计算关键变量，确保作用域覆盖
    try:
        # 按键排序 x1, x2...
        range_keys = sorted(ranges_raw.keys(), key=lambda s: int("".join(filter(str.isdigit, s)) or "0"))
        d_design = len(range_keys) 
    except Exception as e:
        return jsonify({"error": f"Range parsing failed: {str(e)}"}), 400

    init_points = []
    sampling_log_msg = ""
    
    try:
        # 准备 range_list (用于 Random 和 LHS)
        ranges_list = [ranges_raw[k] for k in range_keys]
        
        if init_sampling_method == 'llm':
            # LLM Prompt Sampling
            # 需要特定的初始化模板路径
            init_template_path = os.path.join(current_dir, "Scripts", "prompt_template_Init.md")
            init_points = generate_initial_points_llm(
                ranges_raw, target_range, num_init, 
                client, config['model'], init_template_path
            )
            sampling_log_msg = f"Initialized with LLM Prompt ({len(init_points)} points)."
            
        elif init_sampling_method == 'random':
            # Random Uniform
            init_points = generate_initial_points_random(ranges_list, num_init)
            sampling_log_msg = f"Initialized with Random Uniform ({num_init} points)."
            
        else:
            # Default: LHS
            init_points = generate_initial_points_lhs(ranges_list, num_init)
            sampling_log_msg = f"Initialized with Latin Hypercube Sampling ({num_init} points)."
            
    except Exception as e:
        print(traceback.format_exc())
        return jsonify({"error": f"Init points generation failed: {str(e)}"}), 400
        
    # 6. 流式生成器
    def generate_stream():
        try:
            yield json.dumps({"type": "log", "msg": f"Scenario '{scenario_id}' loaded. Init method: {init_sampling_method}"}) + "\n"
            yield json.dumps({"type": "log", "msg": f">>> {sampling_log_msg}"}) + "\n"
            
            current_points = np.array(init_points)
            messages = []
            
            def local_expand(p):
                if expand_point: return expand_point(p)
                return p
                
            # --- Phase 1: 评估初始点 ---
            penalty_objective_list = []
            for i, point in enumerate(current_points):
                point_full = local_expand(point)
                
                p, c, rels = penalized_cost(
                    point_full, 
                    N=int(config['N']), 
                    threshold=config['threshold'], 
                    reliability_target=config['reliability_target'], 
                    constraint_source=con_fn, 
                    objective_fn=obj_fn, 
                    std=current_std, 
                    penalty_weight=config['penalty_weight'],
                    return_reliabilities=True
                )
                penalty_objective_list.append({
                    "point": point_full, 
                    "design_point": point, 
                    "penalty": p, 
                    "cost": c, 
                    "reliabilities": rels
                })
                
                # 稍微 yield 一下防止大量初始点计算导致超时，也可以让用户看到进度
                if i % 5 == 0:
                    yield json.dumps({"type": "log", "msg": f"Evaluated init point {i+1}/{len(current_points)}..."}) + "\n"
                
            penalties = [x["penalty"] for x in penalty_objective_list]
            objectives = [x["cost"] for x in penalty_objective_list]
            
            valid_indices = [i for i, p in enumerate(penalties) if p == 0]
            if valid_indices:
                valid_objectives = [objectives[i] for i in valid_indices]
                best_idx = valid_indices[np.argmin(valid_objectives)]
            else:
                best_idx = np.argmin(penalties)

            best_point_design = penalty_objective_list[best_idx]["design_point"]
            current_point_design = best_point_design
            best_cost = penalty_objective_list[best_idx]["cost"]
            best_penalty = penalty_objective_list[best_idx]["penalty"]
            best_reliabilities = penalty_objective_list[best_idx]["reliabilities"]
            
            yield json.dumps({
                "type": "update", 
                "iteration": 0,
                "cost": best_cost,
                "penalty": best_penalty,
                "point": best_point_design.tolist(), 
                "reliabilities": best_reliabilities.tolist() if hasattr(best_reliabilities, "tolist") else best_reliabilities
            }) + "\n"
            
            stagnation_count = 0
            max_iter = int(config['max_iterations'])
            target_range = [config['target_range_min'], config['target_range_max']]
            
            # --- Phase 2: 迭代循环 ---
            for i in range(max_iter):
                iter_num = i + 1
                
                mapped_current = map_float_to_int_array(current_point_design.tolist(), ranges_raw, target_range)
                msg_item = {
                    "iteration": iter_num, 
                    "point": mapped_current, 
                    "penalty": best_penalty, 
                    "objective": best_cost
                }
                messages.append(msg_item)
                if len(messages) > int(config.get('retain_number', 5)): 
                    messages = messages[-int(config.get('retain_number', 5)):]
                
                latest_best_int = map_float_to_int_array(best_point_design.tolist(), ranges_raw, target_range)
                best_point_msg = {
                    "iteration": iter_num, 
                    "point": latest_best_int, 
                    "penalty": best_penalty, 
                    "objective": best_cost
                }
                
                try:
                    new_point_llm = generate_new_point_with_llm(
                        messages, best_point_msg, config['temperature'], config['top_p'], 
                        ranges_raw, target_range, client, config['max_tokens'], 
                        config['model'], config['template_path'], print_prompt=False
                    )
                except Exception as e:
                    yield json.dumps({"type": "log", "msg": f"LLM Error: {e}"}) + "\n"
                    new_point_llm = best_point_design 
                
                # --- 扰动生成 ---
                adition_num = int(config.get('adition_point_number', 10))
                addition_points_full = []
                
                addition_points_full.append(local_expand(new_point_llm))
                
                if np.ndim(current_adition_std) > 0 and len(current_adition_std) > d_design:
                    pert_std_design = current_adition_std[:d_design]
                else:
                    pert_std_design = current_adition_std

                for _ in range(adition_num):
                    noise = np.random.normal(0, pert_std_design, size=len(new_point_llm))
                    p_perturb_design = new_point_llm + noise
                    
                    in_bounds = True
                    for idx, k in enumerate(range_keys):
                        if not (ranges_raw[k][0] <= p_perturb_design[idx] <= ranges_raw[k][1]):
                            in_bounds = False
                            break
                    
                    if in_bounds:
                        addition_points_full.append(local_expand(p_perturb_design))
                
                if len(addition_points_full) == 0:
                     clamped_design = np.array(new_point_llm)
                     for idx, k in enumerate(range_keys):
                         clamped_design[idx] = max(ranges_raw[k][0], min(ranges_raw[k][1], clamped_design[idx]))
                     addition_points_full.append(local_expand(clamped_design))

                # --- 批量评估 ---
                group_results = []
                for p_full in addition_points_full:
                    p, c, rels = penalized_cost(
                        p_full, 
                        N=int(config['N']), 
                        threshold=config['threshold'], 
                        reliability_target=config['reliability_target'], 
                        constraint_source=con_fn, 
                        objective_fn=obj_fn, 
                        std=current_std, 
                        penalty_weight=config['penalty_weight'],
                        return_reliabilities=True
                    )
                    # 关键修改：直接使用 d_design 变量，它现在在作用域内
                    p_design = p_full[:d_design] 
                    group_results.append({
                        "point": p_full, 
                        "design_point": p_design, 
                        "penalty": p, 
                        "cost": c, 
                        "reliabilities": rels
                    })
                
                if any(r["penalty"] == 0 for r in group_results):
                    best_grp = min((r for r in group_results if r["penalty"] == 0), key=lambda r: r["cost"])
                else:
                    best_grp = min(group_results, key=lambda r: r["penalty"])
                    
                current_point_design = best_grp["design_point"]
                
                updated = False
                candidate = best_grp
                
                # Rule 1: 如果候选点可行
                if candidate["penalty"] == 0:
                    if best_penalty > 0: # 之前的最优解不可行 -> 更新
                        updated = True
                    elif candidate["cost"] < best_cost: # 之前的也可行，但现在的成本函数更低 -> 更新
                        updated = True
                
                # Rule 2: 如果候选点不可行，但比之前更接近可行 (且允许接受不可行点)
                elif best_penalty > 0:
                    if candidate["penalty"] < best_penalty: # 都在不可行区，选惩罚小的
                        updated = True
                
                if updated:
                    best_point_design = candidate["design_point"]
                    best_cost = candidate["cost"]
                    best_penalty = candidate["penalty"]
                    best_reliabilities = candidate["reliabilities"]
                    stagnation_count = 0
                    yield json.dumps({"type": "log", "msg": f"Iter {iter_num}: Improvement! Cost={best_cost:.4f}, Pen={best_penalty:.4f}"}) + "\n"
                else:
                    stagnation_count += 1
                
                yield json.dumps({
                    "type": "update",
                    "iteration": iter_num,
                    "cost": best_cost,
                    "penalty": best_penalty,
                    "point": best_point_design.tolist(),
                    "reliabilities": best_reliabilities.tolist() if hasattr(best_reliabilities, "tolist") else best_reliabilities
                }) + "\n"
                
                if stagnation_count >= int(config['stagnation_limit']):
                    yield json.dumps({"type": "log", "msg": "Stop: Stagnation limit reached."}) + "\n"
                    break
                    
            yield json.dumps({"type": "log", "msg": "=== Optimization Finished ==="}) + "\n"
        
        except Exception as e:
            # 捕获主循环中的错误并发送给前端
            err_msg = f"Runtime Error: {str(e)}\n{traceback.format_exc()}"
            print(err_msg)
            yield json.dumps({"type": "log", "msg": err_msg}) + "\n"

    return Response(generate_stream(), mimetype='application/x-ndjson')

if __name__ == '__main__':
    print("Starting LLM-RBDO Backend on http://localhost:5000")
    app.run(debug=True, port=5000)