"""LLM-RBDO 优化操作模块
包含功能：
1. generate_new_point_with_llm: 迭代优化时的 LLM 生成
2. generate_initial_points_random: 随机均匀采样
3. generate_initial_points_lhs: 拉丁超立方采样
4. generate_initial_points_llm: 基于 LLM 的初始采样
"""

import numpy as np
import json
from scipy.stats import qmc  
from Scripts.mapping_utils import map_back_to_float_array

# ==============================================================================
#                 1. 迭代优化生成 (Optimization Step)
# ==============================================================================
def generate_new_point_with_llm(messages, best_point_message, temperature, top_p, original_ranges, target_range, client, max_tokens, model, template_path, print_prompt=True):
    """根据历史消息与当前最优点生成一个新的候选设计点

    参数：
    - messages: 列表，每个元素为包含 'iteration'、'point'、'penalty'、'objective' 的字典
    - best_point_message: 字典，描述最近的最优点（同样包含点、penalty 与 objective）
    - temperature: LLM 采样温度
    - top_p: 核采样阈值
    - original_ranges: 设计空间范围字典，键形如 'x{i}_range'
    - target_range: 整数映射区间 [min, max]
    - client: OpenAI 兼容客户端实例
    - max_tokens: 生成长度上限
    - model: 模型名称
    - template_path: 提示模板路径
    - print_prompt: 是否打印提示信息

    返回：
    - numpy.ndarray，新生成的连续空间设计点（形如 [x1, x2, ...]）
    """
    names = []
    for k in sorted(original_ranges.keys(), key=lambda s: int("".join(filter(str.isdigit, s)) or "0")):
        names.append(k.split("_")[0])
    history_lines = ""
    for m in messages:
        history_lines += f"迭代次数{m['iteration']},生成点: {m['point']}, penalty: {m['penalty']},目标函数值: {m['objective']}\n"
    best_section = f"生成点: {best_point_message['point']}, penalty: {best_point_message['penalty']},目标函数值: {best_point_message['objective']}\n"
    ranges_lines = ""
    for name in names:
        ranges_lines += f"{name}: [{target_range[0]}, {target_range[1]}]\n"
    schema = "[\n    {" + ", ".join([f"\"{name}\": " for name in names]) + "}\n]"
    with open(template_path, "r", encoding="utf-8") as f:
        tpl = f.read()
    tpl = tpl.replace("<<VARIABLE_NAMES>>", ", ".join(names))
    tpl = tpl.replace("<<RANGES>>", ranges_lines.strip())
    tpl = tpl.replace("<<HISTORY>>", history_lines.strip())
    tpl = tpl.replace("<<BEST>>", best_section.strip())
    tpl = tpl.replace("<<OUTPUT_SCHEMA>>", schema)
    full_prompt = tpl
    if print_prompt:
        print("\n--- LLM Prompt ---")
        print(full_prompt)
        print("--- End of Prompt ---")
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": "你是一个优化算法助手，目的是寻找到一组解让penalty为0的前提下尽可能降低objective。"},
                      {"role": "user", "content": full_prompt}],
            temperature=temperature,
            top_p=top_p,
            max_tokens=max_tokens
        )
        new_point_str = response.choices[0].message.content.strip()
        start = new_point_str.rindex('[')
        end = new_point_str.rindex(']') + 1
        new_point_json = new_point_str[start:end].strip()
        new_point = json.loads(new_point_json)
        mapped_point = map_back_to_float_array(new_point[0], original_ranges, target_range)
        return mapped_point
    except Exception:
        mapped_best = map_back_to_float_array(best_point_message["point"], original_ranges, target_range)
        return mapped_best

# ==============================================================================
#                 2. 初始点采样 (Initial Sampling Methods)
# ==============================================================================

def generate_initial_points_random(ranges_list, num_points):
    """
    随机均匀采样 (Numpy Uniform)
    ranges_list: [[min, max], [min, max], ...] 对应 x1, x2...
    """
    points = []
    for _ in range(num_points):
        # 对每一维进行均匀采样
        p = [np.random.uniform(r[0], r[1]) for r in ranges_list]
        points.append(np.array(p))
    return points

def generate_initial_points_lhs(ranges_list, num_points):
    """
    拉丁超立方采样 (LHS)
    """
    d = len(ranges_list)
    if d == 0: return []
    
    # 1. 生成 [0, 1] 区间的 LHS 样本
    sampler = qmc.LatinHypercube(d=d)
    sample = sampler.random(n=num_points)
    
    # 2. 缩放到实际物理范围
    l_bounds = [r[0] for r in ranges_list]
    u_bounds = [r[1] for r in ranges_list]
    
    scaled_sample = qmc.scale(sample, l_bounds, u_bounds)
    
    # 转为 list of arrays 格式以保持一致性
    return [row for row in scaled_sample]

def generate_initial_points_llm(original_ranges, target_range, num_points, client, model, template_path):
    """
    通过 LLM 提示词一次性生成多个初始点 (Batch Generation)
    """
    print(f">>> LLM Init: Generating {num_points} points using {model}...")
    
    # 准备 Prompt 变量
    names = []
    ranges_lines = ""
    # 排序保证 x1, x2...
    sorted_keys = sorted(original_ranges.keys(), key=lambda s: int("".join(filter(str.isdigit, s)) or "0"))
    
    for k in sorted_keys:
        name = k.split("_")[0]
        names.append(name)
        ranges_lines += f"{name}: [{target_range[0]}, {target_range[1]}]\n"
    
    try:
        with open(template_path, "r", encoding="utf-8") as f:
            base_tpl = f.read()
    except FileNotFoundError:
        print(f"[Error] Init template not found at {template_path}")
        # 降级到 LHS
        return generate_initial_points_lhs([original_ranges[k] for k in sorted_keys], num_points)

    # 替换变量
    base_tpl = base_tpl.replace("<<RANGES>>", ranges_lines.strip())
    base_tpl = base_tpl.replace("<<NUM_POINTS>>", str(num_points))
    
    points = []
    
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a design sampler. Output strictly valid JSON."},
                {"role": "user", "content": base_tpl}
            ],
            temperature=0.9, # 高温增加多样性
            max_tokens=2048  # 增加 token 上限以容纳多个点
        )
        content = response.choices[0].message.content.strip()
        content = content.replace('```json', '').replace('```', '').strip()
        
        # 解析列表
        start = content.find('[')
        end = content.rfind(']') + 1
        json_str = content[start:end]
        data_list = json.loads(json_str) # [{"x1":...}, {"x1":...}]
        
        print(f"  > LLM returned {len(data_list)} points.")
        
        # 映射回物理空间
        for item in data_list:
            # 只取我们需要的变量，防止 LLM 发挥过度
            p_float = map_back_to_float_array(item, original_ranges, target_range)
            points.append(p_float)
            
        # 如果 LLM 生成的数量不够，用 Random 补齐
        if len(points) < num_points:
            missing = num_points - len(points)
            print(f"  > Missing {missing} points, filling with Random.")
            ranges_list = [original_ranges[k] for k in sorted_keys]
            fill_points = generate_initial_points_random(ranges_list, missing)
            points.extend(fill_points)
            
        # 如果生成多了，截断
        return points[:num_points]
            
    except Exception as e:
        print(f"[Error] LLM Init Failed ({e}), falling back to LHS.")
        ranges_list = [original_ranges[k] for k in sorted_keys]
        return generate_initial_points_lhs(ranges_list, num_points)