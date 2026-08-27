import re

with open('tests/unit/ai-vault.test.ts', 'r') as f:
    text = f.read()

text = text.replace("import { crypto } from 'crypto'", "import crypto from 'crypto'")

with open('tests/unit/ai-vault.test.ts', 'w') as f:
    f.write(text)
