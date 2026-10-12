"""Resolve the N-th (1-based, counting current remaining) diff3 conflict hunk.

usage: python resolve.py <file> <n> <ours|theirs|ours+theirs|theirs+ours|base>
Preserves the file's newline style.
"""
import sys

path, n, side = sys.argv[1], int(sys.argv[2]), sys.argv[3]
data = open(path, 'rb').read().decode('utf-8')
nl = '\r\n' if '\r\n' in data else '\n'
lines = data.split(nl)
out, i, k = [], 0, 0
while i < len(lines):
    if lines[i].startswith('<<<<<<< '):
        k += 1
        j = i + 1
        ours, base, theirs = [], [], []
        cur = ours
        while not lines[j].startswith('>>>>>>> '):
            if lines[j].startswith('||||||| '):
                cur = base
            elif lines[j] == '=======':
                cur = theirs
            else:
                cur.append(lines[j])
            j += 1
        if k == n:
            pick = {'ours': ours, 'theirs': theirs, 'base': base,
                    'ours+theirs': ours + theirs, 'theirs+ours': theirs + ours}[side]
            out.extend(pick)
        else:
            out.extend(lines[i:j + 1])
        i = j + 1
        continue
    out.append(lines[i])
    i += 1
if k < n:
    sys.exit(f'only {k} hunks')
open(path, 'wb').write(nl.join(out).encode('utf-8'))
print(f'resolved hunk {n} of {k} with {side}')
