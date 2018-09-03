load('api_config.js');
load("api_gpio.js");
load("api_timer.js");
load("api_i2c.js");

load("api_df_reg.js");
load("api_df_reg_cfg.js");
load("api_df_reg_var.js");
load("api_df_reg_pcf8574.js");
load("api_df_reg_lm75a.js");

let i2c = I2C.get();

let tickMs = Cfg.get("mix.tickms");
print("Tick set to", tickMs, "ms");

let ledPin = Cfg.get("mix.led");
print("LED pin:", ledPin);
GPIO.set_mode(ledPin, GPIO.MODE_OUTPUT);

let pcfAddress = Cfg.get("mix.pcf");
print("PCF8574 address:", pcfAddress);

let gpos = [];

for (let c = 0; c < 2; c++) {
    let cStr = JSON.stringify(c);
    gpos[c] = {
        register: Register.add("gpo" + cStr, RegisterVariable.create(false)),
        channel: Cfg.get("mix.gpo" + cStr)
    } 
}

let mixs = [];

for (let c = 0; c < 2; c++) {
    let cStr = JSON.stringify(c);
    let lmAddress = Cfg.get("mix.channel" + cStr + ".lm");
    print("LM75A channel", c, "address:", lmAddress);

    mixs[c] = {        
        index: c,
        enabled: Register.add("enabled" + cStr, RegisterConfig.create("mix.channel" + cStr + ".enabled", function(v) {
            let root = { mix: {} };
            root.mix["channel" + JSON.stringify(this.mix.index)] = {
                enabled: v
            };
            return root;
        })),
        target: Register.add("target" + cStr, RegisterConfig.create("mix.channel" + cStr + ".target", function(v) {
            let root = { mix: {} };
            root.mix["channel" + JSON.stringify(this.mix.index)] = {
                target: v
            };
            print(JSON.stringify(root));
            return root;
        })),
        pump: Register.add("pump" + cStr, RegisterVariable.create(true)),
        actual: Register.add("actual" + cStr, RegisterLM75A.create(lmAddress, i2c)),
        max: Cfg.get("mix.channel" + cStr + ".max"),
        outCcw: Cfg.get("mix.channel" + cStr + ".ccw"),
        outCw: Cfg.get("mix.channel" + cStr + ".cw"),
        runMsC: Cfg.get("mix.channel" + cStr + ".runMsC"),
        waitSec: Cfg.get("mix.channel" + cStr + ".waitSec"),
        blocked: false,
        check: function() {
            print("Updating mix", c, this.actual.value, this.target.value, this.enabled.value, this.blocked, this.max, this.outCcw, this.outCw, this.pump.value);
            if (this.enabled.value && this.pump.value && this.actual.value !== null && !this.blocked) {
                let runMs = (this.target.value - this.actual.value) * this.runMsC;
                print("Run ms:", runMs);
            }
        }
    };

    mixs[c].enabled.mix = mixs[c];
    mixs[c].target.mix = mixs[c];
}

let pcf = PCF8574.create(pcfAddress, i2c);

Timer.set(tickMs, true, function (ctx) {

    GPIO.write(ledPin, 1);

    let pcfOut = 0;

    for (let c = 0; c < gpos.length; c++) {
        pcfOut |= gpos[c].register.value? 1 << gpos[c].channel: 0;
    }

    for (let c = 0; c < mixs.length; c++) {
        mixs[c].check();
    }
    
    pcf.write((~pcfOut) & 0xFF);

    Timer.set(100, false, function() {
        GPIO.write(ledPin, 0);
    }, null);

}, null);