def load(p):
    s = open(p, encoding='utf-8', newline='').read()
    nl = '\r\n' if '\r\n' in s else '\n'
    return s.replace('\r\n', '\n'), nl

def save(p, s, nl):
    open(p, 'w', encoding='utf-8', newline='').write(s.replace('\n', nl))

def hunk(s, start_marker_text=None, idx=0):
    """Return (a, ours, base, theirs, end) for the idx-th conflict after start_marker_text."""
    pos = s.index(start_marker_text) if start_marker_text else 0
    a = pos
    for _ in range(idx + 1):
        a = s.index('<<<<<<< ours\n', a if _ == 0 else a + 1)
    m = s.index('||||||| base\n', a)
    t = s.index('=======\n', m)
    e = s.index('>>>>>>> theirs\n', t)
    return a, s[a + 13:m], s[m + 13:t], s[t + 8:e], e + 15
