indicator("SMA", overlay=True)
length = input("Length", 20, min=1)
plot(ta.sma(df.close, length), "SMA", color=color.orange, width=2)
