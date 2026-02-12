
import csv
import json

input_file = r'H:\CODE\業務効率化\学生+ 教員\2025(教職員事務局).csv'
output_list = []

with open(input_file, mode='r', encoding='utf-8-sig') as f:
    reader = csv.DictReader(f)
    for row in reader:
        try:
            dept = row['所属']
            name = row['氏名']
        except KeyError:
            print(f"Error: Headers found are {list(row.keys())}")
            break
        
        # 事務局は除外（必要なら含める）
        if '事務局' in dept:
            continue
            
        # 名称をシンプルにする
        dept = dept.replace('コース', '').replace('一般科目', '一般')
        
        output_list.append({"name": name, "dept": dept})

js_content = "const ALL_TEACHERS = " + json.dumps(output_list, ensure_ascii=False, indent=4) + ";"
with open('teachers_data.js', 'w', encoding='utf-8') as out:
    out.write(js_content)
print("Saved to teachers_data.js")
