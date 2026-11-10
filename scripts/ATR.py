indicator("ATR", overlay=False)
length = input("Length", 14, min=1)
plot(ta.atr(df, length), "ATR", color="#B71C1C", width=2)
