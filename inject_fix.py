
import sys

with open('adan-pred.js', 'r') as f:
    lines = f.readlines()

with open('new_func.js', 'r') as f:
    new_func = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if 'function updateNeuralFlow(d) {' in line and 1900 < i < 2000:
        start_idx = i
    if start_idx != -1 and line.strip() == '}' and i > start_idx:
        # Check if following function starts soon or it is the end of this block
        if i < start_idx + 200: # reasonable size for updateNeuralFlow
             end_idx = i
             break

if start_idx != -1 and end_idx != -1:
    lines[start_idx:end_idx+1] = new_func
    with open('adan-pred.js', 'w') as f:
        f.writelines(lines)
    print(f"Successfully replaced lines {start_idx+1} to {end_idx+1}")
else:
    print(f"Failed to find indices: start={start_idx}, end={end_idx}")
    sys.exit(1)
