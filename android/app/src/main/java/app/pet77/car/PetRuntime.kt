package app.pet77.car

/** 同一个进程里给界面判断桌宠是否正在运行。 */
object PetRuntime {
    @Volatile
    var isRunning: Boolean = false
}
