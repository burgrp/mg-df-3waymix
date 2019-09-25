load('api_config.js');
load("api_gpio.js");
load("api_timer.js");
load("api_i2c.js");

load("api_df_reg.js");
load("api_df_reg_cfg.js");
load("api_df_reg_var.js");
load("api_df_reg_pcf8574.js");
load("api_df_reg_lm75a.js");
load("api_df_reboot.js");

Reboot.after(10);

let i2c = I2C.get();

let tickMs = Cfg.get("mix.tickms");
print("Tick set to", tickMs, "ms");

let ledPin = Cfg.get("mix.led");
print("LED pin:", ledPin);
GPIO.set_mode(ledPin, GPIO.MODE_OUTPUT);

let pcfAddress = Cfg.get("mix.pcf");
print("PCF8574 address:", pcfAddress);

let pcf = PCF8574.create(pcfAddress, i2c);
let pcfOut = [];

function updatePcf() {
    let v = 0;
    for (let c = 0; c < 8; c++) {
        v |= (pcfOut[c]? 1: 0) << c;
    }
    pcf.write((~v) & 0xFF);
}

let gpos = [];

for (let c = 0; c < 2; c++) {
    let cStr = JSON.stringify(c);
    gpos[c] = {
        register: Register.add(Cfg.get("mix.gpo" + cStr + ".name"), RegisterVariable.create(false)),
        channel: Cfg.get("mix.gpo" + cStr + ".channel")
    } 
}

let mixs = [];

for (let c = 0; c < 2; c++) {
    let cStr = JSON.stringify(c);
    let lmAddress = Cfg.get("mix.channel" + cStr + ".lm");
    print("LM75A channel", c, "address:", lmAddress);

    let regPrefix = Cfg.get("mix.channel" + cStr + ".prefix");

    mixs[c] = {        
        index: c,
        enabled: Register.add(regPrefix + "enabled", RegisterConfig.create("mix.channel" + cStr + ".enabled", function(v) {
            let root = { mix: {} };
            root.mix["channel" + JSON.stringify(this.mix.index)] = {
                enabled: v
            };
            return root;
        })),
        target: Register.add(regPrefix + "target", RegisterConfig.create("mix.channel" + cStr + ".target", function(v) {
            let root = { mix: {} };
            root.mix["channel" + JSON.stringify(this.mix.index)] = {
                target: v
            };
            return root;
        })),
        pump: Register.add(regPrefix + "pump", RegisterVariable.create(true)),
        actual: Register.add(regPrefix + "actual", RegisterLM75A.create(lmAddress, i2c)),
        max: Cfg.get("mix.channel" + cStr + ".max"),
        outCcw: Cfg.get("mix.channel" + cStr + ".ccw"),
        outCw: Cfg.get("mix.channel" + cStr + ".cw"),
        outPump: Cfg.get("mix.channel" + cStr + ".pump"),
        runMsC: Cfg.get("mix.channel" + cStr + ".runMsC"),
        runMaxSec: Cfg.get("mix.channel" + cStr + ".runMaxSec"),
        waitSec: Cfg.get("mix.channel" + cStr + ".waitSec"),
        blocked: false,
        check: function() {
            print("Updating mix", c, this.actual.value, this.target.value, this.enabled.value, this.blocked, this.max, this.outCcw, this.outCw, this.pump.value);           

            pcfOut[this.outPump] = this.enabled.value && this.pump.value;

            if (
                this.enabled.value &&
                this.pump.value && 
                this.target.value !== null && 
                this.target.value !== undefined && 
                this.actual.value !== null && 
                this.actual.value !== undefined && 
                !this.blocked
            ) {
                
                let target = this.target.value;
                if (target > this.max) {
                    print("Target of mix", c, "oveflows maximum", this.max);
                    target = this.max;
                }

                let runMs = (target - this.actual.value) * this.runMsC;
                let dir = runMs < 0;
                runMs = Math.abs(runMs);
                
                if (runMs > 500) {

                    if (runMs > this.runMaxSec * 1000) {
                        runMs = this.runMaxSec * 1000;
                    }

                    print("Running mix", c, dir? "CW": "CCW", "for", runMs, "ms");
                    this.blocked = true;
                    pcfOut[this.outCcw] = !dir;
                    pcfOut[this.outCw] = dir;
                    updatePcf();

                    Timer.set(runMs, false, function(mix) {
                        
                        pcfOut[mix.outCcw] = false;
                        pcfOut[mix.outCw] = false;
                        updatePcf();
                        print("Mix", mix.index, "stopped, will wait", mix.waitSec, "seconds");
                        
                        Timer.set(mix.waitSec * 1000, false, function(mix) {
                            mix.blocked = false;
                            print("End of wait of mix", mix.index);
                        }, mix);

                    }, this);
                }
            }                        
        }
    };

    mixs[c].enabled.mix = mixs[c];
    mixs[c].target.mix = mixs[c];
}


Timer.set(tickMs, true, function (ctx) {

    GPIO.write(ledPin, 1);

    for (let c = 0; c < gpos.length; c++) {
        pcfOut[gpos[c].channel] = gpos[c].register.value? 1: 0;
    }

    for (let c = 0; c < mixs.length; c++) {
        mixs[c].check();
    }    

    updatePcf();

    Timer.set(100, false, function() {
        GPIO.write(ledPin, 0);
    }, null);

}, null);