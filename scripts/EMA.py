indicator("EMA", overlay=True)
length = input("Length", 21, min=1)
plot(ta.ema(df.close, length), "EMA", color=color.aqua, width=2)
