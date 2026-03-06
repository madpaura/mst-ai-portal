import os
import re

html_folder = '../site/public'
react_src_folder = 'src/pages'
os.makedirs(react_src_folder, exist_ok=True)

def convert_html_to_jsx(html_str, name):
    # Very basic JSX conversion
    jsx = html_str.replace('class="', 'className="')
    # Self-close simple tags
    jsx = re.sub(r'<(img|input|br|hr|link|meta)([^>]*?)>', r'<\1\2 />', jsx)
    jsx = jsx.replace('style=""', '')
    
    # Extract body content (ignore html/head/body wrapping for simple components)
    body_match = re.search(r'<body[^>]*>(.*?)</body', jsx, re.DOTALL | re.IGNORECASE)
    if body_match:
        jsx = body_match.group(1)
    
    # Optional: wrap in a div or fragment
    jsx = jsx.strip()
    
    comp_str = f"""import React from 'react';

export const {name} = () => {{
  return (
    <div className="bg-background-light dark:bg-background-dark text-slate-900 dark:text-slate-100 min-h-screen">
      {{/* Generated JSX from HTML */}}
      <div dangerouslySetInnerHTML={{{{ __html: `{jsx.replace("`", r"\`").replace("$", r"\$")}` }}}} />
    </div>
  );
}};
"""
    return comp_str

for filename in os.listdir(html_folder):
    if filename.endswith('.html'):
        with open(os.path.join(html_folder, filename), 'r') as f:
            content = f.read()
        name = filename.replace('.html', '').capitalize()
        # Avoid naming conflicts
        if name == 'Index':
            name = 'Solutions'
        
        jsx_code = convert_html_to_jsx(content, name)
        with open(os.path.join(react_src_folder, f'{name}.tsx'), 'w') as f:
            f.write(jsx_code)

print("Converted HTML to React pages")
