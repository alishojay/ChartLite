indicator("VWAP", overlay=True)
anchor = input("Anchor", "D", options=["D", "W", "M"])
plot(ta.vwap(df, anchor), "VWAP", color="#00BCD4", width=2)
