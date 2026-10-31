# Adaptive controller: parameter sensitivity

4 seeds, 1800 s per run, one parameter changed at a time from the defaults. Differences are paired by seed against the default adaptive settings (negative mean wait difference = the variant waits less). The defaults were chosen before these runs and are not changed because of them.

## Light

| Variant | Cleared per hour (veh/h) | Mean wait (s) | Longest wait (s) | Mean wait vs default (s) | Verdict |
|---|---:|---:|---:|---:|---|
| Adaptive (rule-based) | 443 ± 14 | 3.5 ± 0.5 | 23 ± 3 | default |  |
| Adaptive, minGreen = 16 | 443 ± 14 | 4.4 ± 0.5 | 29 ± 4 | +0.9 ± 0.4 | worse |
| Adaptive, minGreen = 20 | 442 ± 14 | 5.4 ± 0.9 | 30 ± 3 | +1.9 ± 0.9 | worse |
| Adaptive, maxGreen = 35 | 443 ± 14 | 3.5 ± 0.5 | 23 ± 3 | -0.0 ± 0.0 | no clear difference |
| Adaptive, maxGreen = 60 | 443 ± 14 | 3.5 ± 0.5 | 23 ± 3 | 0.0 ± 0.0 | no clear difference |
| Adaptive, maxWait = 45 | 443 ± 14 | 3.5 ± 0.5 | 23 ± 3 | 0.0 ± 0.0 | no clear difference |
| Adaptive, maxWait = 120 | 443 ± 14 | 3.5 ± 0.5 | 23 ± 3 | 0.0 ± 0.0 | no clear difference |
| Adaptive, switchRatio = 1.2 | 443 ± 14 | 3.5 ± 0.5 | 23 ± 3 | 0.0 ± 0.0 | no clear difference |
| Adaptive, switchRatio = 2 | 443 ± 14 | 3.5 ± 0.5 | 23 ± 3 | +0.0 ± 0.0 | no clear difference |

## Balanced

| Variant | Cleared per hour (veh/h) | Mean wait (s) | Longest wait (s) | Mean wait vs default (s) | Verdict |
|---|---:|---:|---:|---:|---|
| Adaptive (rule-based) | 962 ± 39 | 21.0 ± 5.2 | 119 ± 23 | default |  |
| Adaptive, minGreen = 16 | 970 ± 52 | 17.7 ± 6.2 | 96 ± 40 | -3.3 ± 13.2 | no clear difference |
| Adaptive, minGreen = 20 | 968 ± 40 | 18.9 ± 5.7 | 101 ± 30 | -2.2 ± 8.3 | no clear difference |
| Adaptive, maxGreen = 35 | 963 ± 40 | 20.5 ± 5.7 | 111 ± 27 | -0.5 ± 1.0 | no clear difference |
| Adaptive, maxGreen = 60 | 962 ± 39 | 21.0 ± 5.2 | 119 ± 23 | 0.0 ± 0.0 | no clear difference |
| Adaptive, maxWait = 45 | 968 ± 47 | 21.1 ± 5.2 | 101 ± 14 | +0.1 ± 5.1 | no clear difference |
| Adaptive, maxWait = 120 | 964 ± 46 | 20.5 ± 5.1 | 112 ± 15 | -0.5 ± 2.8 | no clear difference |
| Adaptive, switchRatio = 1.2 | 956 ± 34 | 22.3 ± 7.4 | 125 ± 40 | +1.3 ± 6.1 | no clear difference |
| Adaptive, switchRatio = 2 | 963 ± 46 | 20.4 ± 5.2 | 103 ± 13 | -0.7 ± 4.0 | no clear difference |

## Uneven

| Variant | Cleared per hour (veh/h) | Mean wait (s) | Longest wait (s) | Mean wait vs default (s) | Verdict |
|---|---:|---:|---:|---:|---|
| Adaptive (rule-based) | 970 ± 31 | 43.5 ± 22.6 | 192 ± 105 | default |  |
| Adaptive, minGreen = 16 | 951 ± 29 | 56.0 ± 15.3 | 223 ± 84 | +12.5 ± 17.8 | no clear difference |
| Adaptive, minGreen = 20 | 917 ± 38 | 83.0 ± 37.1 | 298 ± 113 | +39.4 ± 32.8 | worse |
| Adaptive, maxGreen = 35 | 956 ± 38 | 52.2 ± 27.1 | 207 ± 103 | +8.7 ± 9.3 | no clear difference |
| Adaptive, maxGreen = 60 | 966 ± 31 | 46.2 ± 22.4 | 179 ± 84 | +2.6 ± 14.9 | no clear difference |
| Adaptive, maxWait = 45 | 964 ± 49 | 45.5 ± 27.5 | 198 ± 127 | +2.0 ± 23.2 | no clear difference |
| Adaptive, maxWait = 120 | 973 ± 28 | 43.2 ± 22.1 | 185 ± 98 | -0.4 ± 1.1 | no clear difference |
| Adaptive, switchRatio = 1.2 | 963 ± 39 | 51.2 ± 23.4 | 200 ± 77 | +7.7 ± 15.8 | no clear difference |
| Adaptive, switchRatio = 2 | 980 ± 29 | 42.3 ± 26.1 | 154 ± 89 | -1.2 ± 16.2 | no clear difference |

## Heavy

| Variant | Cleared per hour (veh/h) | Mean wait (s) | Longest wait (s) | Mean wait vs default (s) | Verdict |
|---|---:|---:|---:|---:|---|
| Adaptive (rule-based) | 1076 ± 59 | 250.3 ± 13.8 | 664 ± 54 | default |  |
| Adaptive, minGreen = 16 | 1097 ± 32 | 236.3 ± 12.6 | 620 ± 64 | -14.0 ± 14.7 | no clear difference |
| Adaptive, minGreen = 20 | 1107 ± 65 | 233.3 ± 31.3 | 629 ± 71 | -17.0 ± 34.9 | no clear difference |
| Adaptive, maxGreen = 35 | 1089 ± 54 | 242.6 ± 21.7 | 658 ± 54 | -7.7 ± 17.5 | no clear difference |
| Adaptive, maxGreen = 60 | 1076 ± 59 | 250.3 ± 13.8 | 664 ± 54 | 0.0 ± 0.0 | no clear difference |
| Adaptive, maxWait = 45 | 1099 ± 61 | 236.2 ± 16.7 | 612 ± 55 | -14.1 ± 5.5 | better |
| Adaptive, maxWait = 120 | 1075 ± 35 | 248.4 ± 13.3 | 666 ± 55 | -1.9 ± 18.1 | no clear difference |
| Adaptive, switchRatio = 1.2 | 1087 ± 51 | 238.2 ± 27.5 | 670 ± 22 | -12.0 ± 32.3 | no clear difference |
| Adaptive, switchRatio = 2 | 1088 ± 33 | 245.8 ± 13.3 | 639 ± 90 | -4.5 ± 22.8 | no clear difference |

## Shifting

| Variant | Cleared per hour (veh/h) | Mean wait (s) | Longest wait (s) | Mean wait vs default (s) | Verdict |
|---|---:|---:|---:|---:|---|
| Adaptive (rule-based) | 979 ± 45 | 56.8 ± 37.1 | 196 ± 109 | default |  |
| Adaptive, minGreen = 16 | 978 ± 35 | 64.3 ± 30.5 | 249 ± 89 | +7.5 ± 19.4 | no clear difference |
| Adaptive, minGreen = 20 | 959 ± 33 | 78.7 ± 39.4 | 275 ± 118 | +21.9 ± 18.6 | worse |
| Adaptive, maxGreen = 35 | 967 ± 46 | 62.6 ± 34.7 | 254 ± 125 | +5.8 ± 9.8 | no clear difference |
| Adaptive, maxGreen = 60 | 986 ± 35 | 56.0 ± 32.7 | 203 ± 84 | -0.8 ± 7.6 | no clear difference |
| Adaptive, maxWait = 45 | 979 ± 42 | 54.2 ± 34.1 | 223 ± 108 | -2.6 ± 15.0 | no clear difference |
| Adaptive, maxWait = 120 | 981 ± 31 | 56.0 ± 32.5 | 212 ± 104 | -0.8 ± 11.4 | no clear difference |
| Adaptive, switchRatio = 1.2 | 982 ± 39 | 58.1 ± 30.9 | 219 ± 66 | +1.3 ± 16.7 | no clear difference |
| Adaptive, switchRatio = 2 | 988 ± 34 | 54.3 ± 31.0 | 204 ± 102 | -2.5 ± 15.6 | no clear difference |

