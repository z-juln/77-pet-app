plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.pet77.car"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.pet77.car"
        minSdk = 29
        targetSdk = 34
        versionCode = 1000006
        versionName = "0.0.6"
    }

    buildTypes {
        release {
            // 车机版通过 APK 侧载，不经过应用商店。用调试签名保证后续版本能覆盖安装；
            // 换签名会导致车机必须卸载旧版，设置和位置也会一起丢失。
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets.getByName("main").assets.srcDir(
        layout.buildDirectory.dir("generated/petAssets"),
    )
}

/**
 * 宠物素材只有一份：直接引用鸿蒙工程里的宠物包，构建时复制进安卓 assets。
 * 这样以后新增宠物只改 77-pet-packs / 鸿蒙资源，不会出现两端不同步。
 */
val harmonyPetPacks = rootProject.projectDir.parentFile
    .resolve("harmony/verify-float-pet/entry/src/main/resources/rawfile/pet/packs")

val syncPetPacks = tasks.register<Sync>("syncPetPacks") {
    from(harmonyPetPacks) {
        into("pet/packs")
    }
    into(layout.buildDirectory.dir("generated/petAssets"))
}

tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(syncPetPacks)
}

tasks.matching { it.name.startsWith("lint") || it.name.contains("Lint") }.configureEach {
    dependsOn(syncPetPacks)
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.activity:activity-ktx:1.8.2")
}
